/*
 * Context-retention eval runner — two phases, resumable.
 *
 *   node evals/run.js --label baseline               # generate, then grade
 *   node evals/run.js --label baseline --phase grade # re-grade saved replies only
 *   node evals/run.js --label wide --history 16
 *
 * WHY TWO PHASES: generation is the expensive, rate-limited half. A judge failure
 * (or a tweak to the rubric) must never force a re-run of it. Phase 1 writes
 * results/<label>.raw.json incrementally — one case at a time — so a 429 twelve
 * cases in doesn't throw away the eleven that worked. Phase 2 grades from that
 * file and can be re-run for free.
 *
 * FREE-TIER REALITY: Gemini's daily quota is exhausted, so chatHandler falls all
 * the way through to Groq. Groq's TPM ceiling is PER MODEL, so the judge runs on
 * a different model (Qwen) and therefore a different budget — otherwise the judge
 * and the thing it's judging starve each other.
 */
const fs = require('fs');
const path = require('path');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const label = arg('label', 'run');
const only = arg('only', null);
const phase = arg('phase', 'all'); // all | generate | grade
const history = arg('history', null);
if (history) process.env.AI_HISTORY_TURNS = history;

const core = require('../api/_lib/core');
const cases = require('./cases');
const appContext = require('./context');
const { grade, JUDGE_MODEL } = require('./grade');

const RESULTS = path.join(__dirname, 'results');
const rawPath = (l) => path.join(RESULTS, `${l}.raw.json`);
const outPath = (l) => path.join(RESULTS, `${l}.json`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ~1.8k tokens per chat call against an 8k/min ceiling ≈ 4 calls/min.
const PAUSE_MS = Number(process.env.EVAL_PAUSE_MS || 14000);
const MAX_RETRIES = 3;

const isRateLimit = (msg) => /rate limit|RESOURCE_EXHAUSTED|429|quota|request too large/i.test(msg || '');
// Groq tells us exactly how long to wait; obey it rather than guessing.
const retryAfter = (msg) => {
  const m = /try again in ([\d.]+)s/i.exec(msg || '');
  return m ? Math.ceil(Number(m[1]) * 1000) + 1500 : null;
};

async function askWithRetry(messages) {
  let lastErr = '';
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const { body } = await core.chatHandler({ messages, context: appContext });
    if (!body.error) return body;
    lastErr = body.error;
    if (!isRateLimit(lastErr) || attempt === MAX_RETRIES) break;
    const wait = retryAfter(lastErr) || 20000 * attempt;
    process.stdout.write(`\n      rate-limited, waiting ${Math.round(wait / 1000)}s… `);
    await sleep(wait);
  }
  throw new Error(lastErr);
}

// A raw file's transcripts were generated under ONE history window, and that is
// what the baseline-vs-window comparison depends on. Reusing a file made under a
// different window would grade stale transcripts and label them with the wrong
// window, so refuse loudly instead — never reuse, never overwrite.
function loadRaw(effectiveHistory) {
  if (!fs.existsSync(rawPath(label))) return null;
  const existing = JSON.parse(fs.readFileSync(rawPath(label)));
  if (existing.historyTurns !== effectiveHistory) {
    console.error(
      `${path.relative(process.cwd(), rawPath(label))} was generated with historyTurns=${existing.historyTurns}, ` +
        `but this run uses ${effectiveHistory}. Pick a different --label, or delete that file.`
    );
    process.exit(1);
  }
  return existing;
}

async function generate(list, effectiveHistory) {
  const existing = loadRaw(effectiveHistory) || { cases: {} };
  const store = existing.cases || {};

  for (const c of list) {
    if (store[c.id] && !store[c.id].error) {
      console.log(`  ${c.id.padEnd(24)} cached`);
      continue;
    }
    process.stdout.write(`  ${c.id.padEnd(24)} `);
    const replies = [];
    const providers = [];
    const messages = [];
    try {
      for (const turn of c.turns) {
        messages.push({ role: 'user', text: turn });
        const body = await askWithRetry(messages);
        replies.push(body.reply);
        providers.push(`${body.provider}/${body.model}`);
        messages.push({ role: 'assistant', text: body.reply });
        process.stdout.write('.');
        await sleep(PAUSE_MS);
      }
      store[c.id] = { replies, providers };
      console.log(' ok');
    } catch (e) {
      store[c.id] = { error: e.message, replies, providers };
      console.log(` ERROR ${e.message.slice(0, 90)}`);
    }
    // Write after every case: a later failure must not cost the earlier work.
    // The stamp is the window this run generates under; loadRaw has already
    // guaranteed any pre-existing file carries the same value.
    fs.writeFileSync(rawPath(label), JSON.stringify({ historyTurns: effectiveHistory, cases: store }, null, 2));
  }
  return store;
}

async function gradeAll(list, store, effectiveHistory) {
  const results = [];
  for (const c of list) {
    const rec = store[c.id];
    process.stdout.write(`  ${c.id.padEnd(24)} `);
    if (!rec || rec.error || rec.replies.length !== c.turns.length) {
      console.log(`SKIP  (no complete transcript: ${rec?.error?.slice(0, 60) || 'missing'})`);
      results.push({ id: c.id, category: c.category, distance: c.distance, score: null, reason: 'no transcript' });
      continue;
    }
    try {
      // The judge shares an org-wide token-per-minute budget, and Groq reports
      // exhaustion as "Request too large" regardless of actual payload size — the
      // smallest transcript in the set failed while a 3x larger one passed. So it
      // is a rate condition, and backoff clears it.
      let out, lastErr;
      for (let attempt = 1; attempt <= 4; attempt++) {
        try {
          out = await grade({ turns: c.turns, replies: rec.replies, rubric: c.rubric, appContext });
          break;
        } catch (err) {
          lastErr = err;
          if (!isRateLimit(err.message) || attempt === 4) throw err;
          const wait = retryAfter(err.message) || 15000 * attempt;
          process.stdout.write(`(rate-limited, ${Math.round(wait / 1000)}s) `);
          await sleep(wait);
        }
      }
      if (!out) throw lastErr;
      const { score, reason } = out;
      const mark = score === 2 ? 'PASS' : score === 1 ? 'PART' : 'FAIL';
      console.log(`${mark} (${score}/2)  ${reason}`);
      results.push({ id: c.id, category: c.category, distance: c.distance, score, reason, replies: rec.replies, providers: rec.providers });
    } catch (e) {
      console.log(`JUDGE ERROR  ${e.message.slice(0, 90)}`);
      results.push({ id: c.id, category: c.category, distance: c.distance, score: null, reason: `judge error: ${e.message}` });
    }
    await sleep(8000);
  }

  const scored = results.filter((r) => r.score !== null);
  const sum = (a) => a.reduce((n, r) => n + r.score, 0);
  const inW = scored.filter((r) => r.distance <= effectiveHistory);
  const outW = scored.filter((r) => r.distance > effectiveHistory);

  const summary = {
    label,
    when: new Date().toISOString(),
    historyTurns: effectiveHistory,
    judge: JUDGE_MODEL,
    graded: scored.length,
    ungraded: results.length - scored.length,
    total: sum(scored),
    max: scored.length * 2,
    pct: scored.length ? Math.round((sum(scored) / (scored.length * 2)) * 100) : 0,
    inWindow: { n: inW.length, score: sum(inW), max: inW.length * 2 },
    outWindow: { n: outW.length, score: sum(outW), max: outW.length * 2 },
    results,
  };

  console.log(`\n  TOTAL ${summary.total}/${summary.max} (${summary.pct}%)   ungraded: ${summary.ungraded}`);
  console.log(`    within history window : ${summary.inWindow.score}/${summary.inWindow.max}  (${summary.inWindow.n} cases)`);
  console.log(`    beyond history window : ${summary.outWindow.score}/${summary.outWindow.max}  (${summary.outWindow.n} cases)`);
  fs.writeFileSync(outPath(label), JSON.stringify(summary, null, 2));
  console.log(`\n  → ${path.relative(process.cwd(), outPath(label))}\n`);
  return summary;
}

(async () => {
  const list = only ? cases.filter((c) => c.id === only) : cases;
  if (!list.length) {
    console.error(`no case matching --only ${only}`);
    process.exit(1);
  }
  const effectiveHistory = Number(process.env.AI_HISTORY_TURNS || 6);
  console.log(`\nlabel=${label}  cases=${list.length}  AI_HISTORY_TURNS=${effectiveHistory}  judge=${JUDGE_MODEL}  phase=${phase}\n`);

  let store;
  if (phase === 'grade') {
    if (!fs.existsSync(rawPath(label))) {
      console.error(`no saved transcripts at ${rawPath(label)} — run the generate phase first`);
      process.exit(1);
    }
    store = loadRaw(effectiveHistory).cases;
  } else {
    console.log('  — generating —');
    store = await generate(list, effectiveHistory);
    if (phase === 'generate') return;
    console.log('\n  — grading —');
  }
  await gradeAll(list, store, effectiveHistory);
})();
