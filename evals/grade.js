/*
 * LLM-as-judge for the context-retention eval.
 *
 * Deliberately uses GROQ while the app's primary is Gemini: a model grading its
 * own output rates it too kindly, so the judge is a different family entirely.
 * The judge never sees which prompt version produced the reply, only the
 * conversation, the rubric and the app's ground-truth weather data — so it
 * cannot infer which run it is scoring and grade it accordingly.
 */
const https = require('https');

const GROQ_KEY = process.env.GROQ_API_KEY || '';
// Whatever the app uses via Gemini, the judge must not be the same model. Gemini
// is the app's primary, so a Groq model is a different family by construction.
// gpt-oss-120b is the most capable one available on this account.
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL || 'qwen/qwen3.8-27b';

const RUBRIC_PREAMBLE = `You are grading a weather-app chatbot on ONE thing: did it keep the thread of the conversation?

You will see a multi-turn conversation and a rubric describing what the FINAL assistant reply had to demonstrate.

Score strictly:
  2 = fully satisfies the rubric. The reply is grounded in what was established earlier.
  1 = partially. Right subject but hedged, vague, incomplete, or it had to ask the user to repeat something it should have known.
  0 = fails. It answered about the wrong place/time/topic, ignored what the user told it, or asked what the user was referring to.

Judge SUBSTANCE, not style. Brevity is fine and is in fact the app's house style — never dock points for a short reply. Never reward fluency: a confident, well-written reply about the WRONG city scores 0.
If the reply asks a clarifying question about something already stated earlier in the conversation, that is 0.

Reply with ONLY a JSON object, no prose, no code fence:
{"score": 0|1|2, "reason": "<one sentence, max 25 words>"}`;

const post = (payload) =>
  new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${GROQ_KEY}`,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 45000,
      },
      (res) => {
        let raw = '';
        res.on('data', (d) => (raw += d));
        res.on('end', () => resolve({ status: res.statusCode, raw }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('judge timeout')));
    req.end(body);
  });

const transcript = (turns, replies) =>
  turns.map((t, i) => `USER: ${t}\nASSISTANT: ${replies[i] ?? '(no reply)'}`).join('\n\n');

async function grade({ turns, replies, rubric, appContext }) {
  if (!GROQ_KEY) throw new Error('GROQ_API_KEY required for the judge');

  // Compact ground truth: the full context JSON was ~800 tokens per judge call,
  // which alone ate a tenth of Groq's 8k/min budget. The judge only needs enough
  // to tell a right answer from a confident wrong one.
  const l = appContext.location;
  const rain = appContext.hourly_next_hours
    .map((h) => `${h.time.slice(11, 16)} ${h.chance_of_rain_pct}%`)
    .join(', ');
  const fc = appContext.forecast_days
    .map((d) => `${d.date}: ${d.condition}, ${d.low_c}-${d.high_c}C, ${d.chance_of_rain_pct}% rain`)
    .join(' | ');

  const user = `CONVERSATION:
${transcript(turns, replies)}

GROUND TRUTH — the app's loaded city is ${l.city}, ${l.region}: ${l.temp_c}C (feels ${l.feels_like_c}C), ${l.condition}, ${l.today_low_c}-${l.today_high_c}C today, UV ${l.uv_index}, humidity ${l.humidity_pct}%, wind ${l.wind_kph}kph ${l.wind_dir}, sunset ${l.sunset}, AQI ${l.aqi_us_epa}, local time ${l.localtime}.
Hourly rain chance: ${rain}
Forecast: ${fc}

RUBRIC for the FINAL assistant reply:
${rubric}

Grade the FINAL assistant reply only.`;

  const { status, raw } = await post({
    model: JUDGE_MODEL,
    temperature: 0,
    max_tokens: 1200,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: RUBRIC_PREAMBLE },
      { role: 'user', content: user },
    ],
  });

  if (status !== 200) throw new Error(`judge HTTP ${status}: ${raw.slice(0, 200)}`);
  const text = JSON.parse(raw).choices?.[0]?.message?.content || '';
  let out;
  try {
    out = JSON.parse(text);
  } catch {
    throw new Error(`judge returned non-JSON: ${text.slice(0, 200)}`);
  }
  const score = Number(out.score);
  if (![0, 1, 2].includes(score)) throw new Error(`judge returned bad score: ${text.slice(0, 120)}`);
  return { score, reason: String(out.reason || '').slice(0, 200) };
}

module.exports = { grade, JUDGE_MODEL };
