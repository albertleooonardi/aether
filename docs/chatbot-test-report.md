# Chatbot — Error Report & Fix List

**Date:** 2026-08-25 · **Branch:** `main` @ `acc7f62` · **Scope:** `src/chat/`, `src/components/chat/ChatWidget.jsx`, `src/services/AetherAI.js`, `api/_lib/core.js`
**Existing suite:** 92 passed / 0 failed — every defect below is uncovered by current tests.

```
PASS src/chat/assistant.test.js
PASS src/chat/intents.test.js
PASS src/chat/conversation.test.js

Test Suites: 3 passed, 3 total
Tests:       92 passed, 92 total
Time:        1.1 s
```

---

## Summary

| # | Defect | Location | Severity | Effort |
| --- | --- | --- | --- | --- |
| 1 | `travelling`/`commuting to X` never reaches the route handler | `src/chat/intents.js:38` | High | S |
| 2 | "forecast for tomorrow" geocoded as a city named *tomorrow* | `src/chat/intents.js:115` | High | S |
| 3 | `placeAfter` swallows the trailing clause into the place name | `src/chat/intents.js:116` | High | M |
| 4 | A `.` truncates a destination to one token (`Jl.` → `Jl`) | `src/chat/intents.js:18` | Medium | S |
| 5 | `includes('rain')` matches inside *train* / *terrain* / *Ukraine* | `src/chat/assistant.js:135` | Medium | S |
| 6 | Sunrise/sunset questions answered with the UV index | `src/chat/assistant.js:169` | Medium | S |
| 7 | `checkStatus` leaks its 4s abort timer on every failed probe | `src/services/AetherAI.js:47` | Low | S |
| 8 | `POST /api/chat` silently drops `{role, content}` messages | `api/_lib/core.js:82` | Low | S |

Suggested order: **1, 2, 5** (small, high impact, each deserves a regression test) → **3, 4, 6** → **7, 8**.

---

## 1. `travelling` / `traveling` / `commuting to X` never reaches the route handler

**Location:** [`src/chat/intents.js:38`](../src/chat/intents.js#L38) — the `NAV` alternation.
**Severity:** High — the user gets a confidently wrong answer about the wrong city.

**Repro**

```
travelling to Malang tomorrow, will it rain?
traveling to Malang, will it rain?
commuting to Bandung, any rain?
```

| | |
| --- | --- |
| Expected | `{ kind: 'route', destText: 'Malang', asksRain: true }` |
| Actual | `{ kind: 'fallback' }` → *"No rain expected in Jembatanmerah for the next 2 hours…"* |

**Cause** — `NAV` gives inflections only to `head(?:ing|ed)?`, `go(?:ing|nna)?` and `visit(?:ing)?`. `commute` and `travel` are bare alternatives inside `\b…\b`, so `travelling` / `traveling` / `commuting` never match, `hasNav` is false, and the message falls through to the current-city rain rule. This is exactly the class of bug the file's own comment above `NAV` says was fixed for "going to".

**Fix** — give both verbs the same inflection treatment:

```js
const NAV =
  '(?:routes?|directions?|navigate|navigation|driv(?:ing|e)|commut(?:ing|es?|e)|travell?(?:ing|s|ed)?|head(?:ing|ed)?|way|go(?:ing|nna)?|omw|on my way|visit(?:ing)?|leaving)';
```

Note the doubled `l` is optional (`travell?`) so both the British and American spellings match.

**Regression test** — add to `intents.test.js`, alongside the existing `going to` cases.

---

## 2. "What's the forecast for tomorrow?" is geocoded as a place called *tomorrow*

**Location:** [`src/chat/intents.js:115`](../src/chat/intents.js#L115) — `placeAfter`, the trailing-time-word strip on line 125.
**Severity:** High — one of the most common questions a weather app receives.

**Repro**

```
what is the forecast for tomorrow   → { kind: 'weather-in', place: 'tomorrow' }
what is the forecast for today      → { kind: 'weather-in', place: 'today' }
will it rain in the afternoon       → { kind: 'weather-in', place: 'the afternoon' }
```

| | |
| --- | --- |
| Expected | fall through to `answer()`, which already has a tomorrow rule reading `forecast[0]` |
| Actual | `handleWeatherIn('tomorrow')` geocodes it → *"I couldn't find weather for "tomorrow""* — or worse, a real place that happens to be named Today/Tomorrow |

**Cause** — the strip on line 125 is `/\s+(today|now|right now|tomorrow|please|rn|currently)$/i`. The required leading `\s+` means it only removes a time word that *trails* a place; when the captured place **is** the time word, nothing is stripped and the bare word is returned. `TIME_WORD` on line 144 already encodes this exact set, but only `parseFollowUp` uses it.

**Fix** — reject a place that is nothing but a time word, reusing the existing constant. Move `TIME_WORD` above `placeAfter` and add a guard next to the `isHere` one:

```js
if (isHere(place)) return null;
if (TIME_WORD.test(place)) return null;   // "forecast for tomorrow" is not a place
```

`TIME_WORD` already covers `the afternoon`, `tonight`, `later`, `this morning`, etc.

**Regression test** — the three repro strings must route to `fallback`, and `answer('what is the forecast for tomorrow', weather, [], [], forecast)` must return the *Tomorrow in …* line.

---

## 3. `placeAfter` swallows the whole trailing clause into the place name

**Location:** [`src/chat/intents.js:116`](../src/chat/intents.js#L116) — the capture group.
**Severity:** High — produces an ungeocodable string, so the reply is an error message.

**Repro**

```
is the weather good for running in Bandung   → place: 'running in Bandung'
will it rain in Bandung on my way home       → place: 'Bandung on my way home'
```

| | |
| --- | --- |
| Expected | `Bandung` |
| Actual | the full clause, handed verbatim to the geocoder → *"I couldn't find weather for "running in Bandung""* |

**Cause** — the capture is `([A-Za-z][^?.,;]*)`: greedy up to the next punctuation mark. The only recovery path is the `WEATHER_WORD` retry on line 122, which re-runs `placeAfter` on the remainder when the captured head is a weather noun. Any other filler head (`running`, `walking`, `my trip`) is kept, and any trailing clause not separated by a comma is kept too.

**Fix** — two independent changes, both worth making:

- **Prefer the last preposition, not the first.** Match all `PLACE_PREP` occurrences and take the final one; `running in Bandung` then captures from `in Bandung`. Cheap and fixes the leading-filler half.
- **Terminate on trailing-clause markers as well as punctuation.** Cut the capture at ` on my way`, ` when `, ` while `, ` before `, ` after `, ` if ` — the same idea as the `STOP` terminator that `parseNavigation` already uses.

A non-weather head that survives both (an unknown filler word) is still possible; the geocoder failure message is an acceptable floor for that case.

**Regression test** — both repro strings must yield `Bandung`, and the existing `chance of rain in Pontianak` case must keep passing (guard against regressing the `WEATHER_WORD` retry).

---

## 4. A `.` inside a destination truncates it to one token

**Location:** [`src/chat/intents.js:18`](../src/chat/intents.js#L18) — the `STOP` terminator.
**Severity:** Medium — hits normal input for this app's locale (`Jl.` = Jalan).

**Repro**

```
navigate to Jl. Tunjungan No. 1   → destText: 'Jl'
route to Dr. Soetomo Hospital     → destText: 'Dr'
directions to St. Mary Hospital   → destText: 'St'
```

| | |
| --- | --- |
| Expected | the full address / name |
| Actual | a two-letter fragment sent to the geocoder |

Removing the dots (`navigate to Jl Tunjungan No 1`) parses correctly, confirming the dot is the cause.

**Cause** — `STOP` is `(?:[?.,;:!]|\s+[—–-]\s*|$)` and treats a bare `.` as a clause terminator, which is right for *"route to Bandung. Thanks"* but wrong for an abbreviation.

**Fix** — only treat `.` as a terminator when it ends a sentence, i.e. when followed by whitespace-plus-capital or end-of-string, and never after a 1–3 letter token:

```js
const STOP = '(?:[?,;:!]|\\.(?=\\s+[A-Z]|\\s*$)|\\s+[—–-]\\s*|$)';
```

Then exempt the common abbreviation prefixes (`Jl.`, `Dr.`, `St.`, `Mt.`, `No.`, `Gg.`) from even that, since `Jl. Tunjungan` is exactly "dot followed by a capital".  A short `ABBREV` lookbehind list is the clearest way.

**Regression test** — the three repro strings, plus the still-valid *"route to Bandung. Thanks"* → `Bandung`.

---

## 5. `t.includes('rain')` matches inside *train* / *terrain* / *Ukraine*

**Location:** [`src/chat/assistant.js:135`](../src/chat/assistant.js#L135) — the rain rule.
**Severity:** Medium — first-match-wins means the broad rule swallows two specific rules below it.

**Repro**

```
what should I wear on the train
do I need a jacket on the train?
is Ukraine cold?
```

| | |
| --- | --- |
| Expected | the clothing reply (line 149) or the temperature reply (line 158) |
| Actual | *"No rain expected in Jembatanmerah for the next 2 hours…"* |

**Cause** — `t.includes('rain')` is a raw substring test, and the rain rule sits above `wear\|dress\|jacket` and `hot\|cold\|temp`. `training` was already special-cased into the exercise rule above it — the same bug, caught once and not generalised.

**Fix** — make the test word-boundaried and inflection-aware, matching how `parseWeatherIn` already does it:

```js
if (/\brain(?:ing|y|s)?\b/.test(t) || t.includes('umbrella') || t.includes('wet')) {
```

`\brain\b` does not match `train`, `terrain` or `Ukraine`, and the `training` special case above can then be simplified.

**Regression test** — the three repro strings, in `assistant.test.js`'s existing *rule ordering* describe block.

---

## 6. Sunrise / sunset questions are answered with the UV index

**Location:** [`src/chat/assistant.js:169`](../src/chat/assistant.js#L169) — the UV rule.
**Severity:** Medium — the data to answer correctly is already in scope.

**Repro**

```
what time is sunset
when does the sun set
what time is sunrise
```

| | |
| --- | --- |
| Expected | the sunrise/sunset times — `w.sunrise` / `w.sunset` are already passed into `aiContext` |
| Actual | *"The UV index is 7. High — wear sunscreen."* |

**Cause** — `t.includes('sun')` is a substring test, and there is no sunrise/sunset rule anywhere above it.

**Fix** — add a specific rule **above** the UV rule, and tighten the UV test:

```js
if (/\bsun(?:rise|set)\b/.test(t) || /\bsun\s+(?:rise|set|goes down|comes up)\b/.test(t)) {
  return `In ${weather.city}, sunrise is at ${weather.sunrise} and sunset at ${weather.sunset}.`;
}
if (t.includes('uv') || /\bsun(?:ny|shine)?\b/.test(t)) { … }
```

Confirm `sunrise`/`sunset` are on the weather object App.js builds before relying on them in the reply string; they are present in the AI context, so plumb them through if the card shape lacks them.

**Regression test** — the three repro strings must not return the UV line.

---

## 7. `checkStatus` leaks its 4-second abort timer on the failure path

**Location:** [`src/services/AetherAI.js:47`](../src/services/AetherAI.js#L47).
**Severity:** Low — harmless in a browser, but a real hazard for tests.

**Repro** — stub `fetch` to reject and call `checkStatus()`; the node process exits 4.0s after the promise resolves (`4.046s total`).

**Cause** — `t.clear()` is only reached *after* `await fetch` succeeds. When fetch throws (network failure, abort), control jumps to the `catch` and the timer is never cleared. `askAI` in the same file gets this right with `try/finally`.

**Impact** — aborting a settled request is a no-op in a browser, so there is no user-visible bug today. But `ChatWidget` re-probes every 30 s while open, and any future jsdom/fake-timer test of the widget will hit "work scheduled after teardown" warnings.

**Fix** — mirror `askAI`:

```js
export const checkStatus = async () => {
  const t = withTimeout(4000);
  try {
    const res = await fetch('/api/health', { signal: t.signal });
    …
  } catch {
    return { status: 'offline', providers: null, primary: null };
  } finally {
    t.clear();
  }
};
```

---

## 8. `POST /api/chat` silently discards OpenAI-style `content` messages

**Location:** [`api/_lib/core.js:82`](../api/_lib/core.js#L82) — `trimmed()`.
**Severity:** Low — a contract/robustness gap, not a live app break.

**Repro**

```bash
curl -s -X POST localhost:3001/api/chat -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"hi"}],"context":{}}'
```

| | |
| --- | --- |
| Expected | an answer to the user's message, or an HTTP 400 |
| Actual | HTTP 200 with *"Sure thing! Just let me know which city…"*, and `GET /api/usage` shows `gemini.lastError: "GenerateContentRequest.contents: contents is not specified"` |

So Gemini was called with an empty conversation, 400'd, failover fired, and Groq answered a prompt containing no user text at all.

**Cause** — `trimmed()` filters on `m.text`, so any message shaped `{ role, content }` is dropped. The app itself always sends `text` (`ChatWidget.jsx:413`), which is why nothing breaks in production — but it makes a curl probe *look* healthy while the message never arrives, and it burns a provider failover on every such call.

**Fix** — accept either key, and reject a payload that reduces to nothing:

```js
const trimmed = (messages) =>
  (messages || [])
    .slice(-HISTORY_TURNS)
    .map((m) => m && { ...m, text: m.text || m.content })
    .filter((m) => m && m.text);
```

…and in `chatHandler`, return `400 { error: 'no_messages' }` when `trimmed()` is empty, rather than calling a provider with nothing.

---

## Lower-severity observations (not filed as defects)

- **A reminder with no parseable time gets the generic blurb.** `remind me to water plants`, `…at 25:00`, `…at 12:70`, `…at noon`, `…tomorrow morning` all make `parseReminder` return `null`, and nothing downstream knows a reminder was attempted. Bad times are correctly *rejected* — no bogus reminder is created — so the invariant holds; only the reply is unhelpful. Asking *"when should I remind you?"* would be the improvement.
- **`pending.current` is never cleared when the user changes subject** (`ChatWidget.jsx:260,268`), so a Maps URL pasted many turns later is routed against a stale destination question.
- **A bare Maps URL with no pending route** (`ChatWidget.jsx:368`) matches neither the URL branch nor `parseNavigation` (no nav word) and gets the generic blurb.
- **Basic mode has no rule for snow, storm, pressure, visibility, AQI, or a bare "what's the weather?"** — all return the capabilities blurb even though the data is on the weather object.
- **No length cap on chat input** — a 40 k-character message is forwarded verbatim to the provider (returns 200, garbage reply).

## Verified working

- All 92 existing chat tests pass unmodified.
- `answer()` rule ordering: greetings, hourly-aware rain (names the hour when an hour ≥ 40 % exists, else reports the peak), wind, humidity, UV, clothing, temperature, today's forecast, tomorrow answered from `forecast[0]`, the exercise/outdoor verdict (heat, humidity, UV and smoke all flagged), and the multi-city refusal. No-weather guards return the "search for a city" copy on every branch.
- Reminders: `at 5pm`, `in 30 min`, `in 90 minutes`, `in 2 hours`, all-caps and newline-separated all parse with correct labels; bare `at 5pm` falls back to "your reminder"; listing filters to `dueEpoch > Date.now()` and sorts ascending.
- Navigation: `to` / `into` / `towards`, `from X to Y`, dash- and comma-terminated clauses, `going to` / `gonna go to` / `omw` / `on my way to` / `heading towards` / `driving to` / `leaving to` / `visiting` / `best route`, time tails split into `departAt`, day words stripped, pasted Maps URLs taken verbatim and never sliced at their dots, and the `going to be hot` / `going to rain` false-positive guards.
- Follow-ups: `what about Central Park?`, `and Bandung?`, `how about at 8pm`, `what about in 2 hours` → correct; `and will it rain?`, `what about later`, `what about my place` correctly `null`.
- Junk input: empty, whitespace, `???`, emoji, gibberish all reach the fallback with no throw; no catastrophic backtracking (14,024-char message routed in 0.13 ms).
- `askAI` throws on all five failure modes (HTTP 500, network reject, unparseable body, `{error:'no_key'}`, `{reply:''}`), so `ChatWidget`'s catch always reaches the local assistant — never an empty bubble.
- `checkStatus` maps to exactly `online` / `basic` / `offline`; nothing else can be returned.
- Backend: `api/_lib/core.js` loads clean; server came up on :3001 with both keys (`Gemini(gemini-flash-latest) → Groq(openai/gpt-oss-120b)`); `/api/health` → `{"ok":true,"ai":true,…}`; malformed JSON → 400 `bad_json`; `GET /api/chat` → 404; no crashes or unhandled rejections on any edge case.

## Not covered

- **React/DOM behaviour of `ChatWidget`** — no render test exists, so routing order was verified by replaying the same call sequence against the real modules. Untested in jsdom: `localStorage` persistence and the mount-time purge of past-due reminders, `setTimeout` reminder firing, the `Notification` permission prompt, busy/disabled input states, the 30 s status poll, and `PlacePicker` / `ChatRouteMap` / `WeatherReplyCard` rendering.
- **Network handlers behind the intents** — `fetchWeatherByCity`, `geocode`, `resolveMapsUrl`, `getRoutesWithRain` were not called, so the consequences of defects 2–4 are established from the bad string handed to the geocoder rather than an observed geocoder response.
- **The `basic` (no-key) path end to end** — this machine has both keys in `.env.local`, so the probe ran `online`. No-key behaviour was covered at the client level (stubbed `{error:'no_key'}` → local fallback) and by reading `chatHandler`'s guard.

---

*Generated by the `chatbot-tester` agent ([.claude/agents/chatbot-tester.md](../.claude/agents/chatbot-tester.md)). No source files were modified during this test pass.*
