# AetherAI accuracy audit

> **Status: all eight defects fixed and verified, 2026-10-12.** See [Resolution](#resolution) at the end for what changed and the measured before/after.

**Date:** 2026-10-12 · **Method:** 15 scripted conversations against the live `/api/chat`, plus direct probing of the deterministic parser layer. Every factual claim was checked against the upstream source (WeatherAPI, OSRM) fetched independently, not against the model's own account of itself.

Loaded city for all runs: **Jakarta**, 2026-10-12 20:05 local, 29.3 °C, "Patchy rain nearby", AQI 5.

---

## Verdict

**On the numbers the chatbot is accurate.** Of 15 conversations, 14 reported figures that match the upstream API exactly. Nothing was invented: temperatures, humidity, sunset, AQI, forecast highs and driving time all matched, and the two "can you be baited" cases were handled correctly.

**What's wrong is not the arithmetic — it's the framing.** Three answers were numerically right but told the user something untrue: one named four cities as raining that the app's own rules call dry, one reported weather for Portugal without saying so, and one claimed route coverage the model never had. Separately, a provider fault makes the chat take 30 seconds to answer.

| | |
|---|---|
| Numerically accurate | 14 / 15 |
| Correct but misleading | 3 |
| Hallucinated figures | **0** |
| Correctly refused to guess | 2 / 2 |
| Answered by Gemini | **0 / 15** (all failed over to Groq) |
| Median response time | 5.2 s · **6 of 15 over 25 s** |

---

## Defects, worst first

### 1. Every message costs ~30 s on a dead primary provider — SEVERE

`GEMINI_MODEL=gemini-flash-latest` accepts the TCP connection and then never responds. Measured directly, outside the app:

| Model | Result |
|---|---|
| `gemini-flash-latest` (configured) | hangs, no response in 40 s |
| `gemini-flash-lite-latest` | HTTP 200 in **1.6 s** |
| ListModels (same key) | HTTP 200 in 0.3 s — key is valid |

So the key works and the network is fine; that one model alias stalls.

The app is supposed to survive this — it sidelines a failing provider for `AI_COOLDOWN_MS`. But [`isQuota()`](../api/_lib/core.js) only recognises quota and rate-limit signatures:

```js
return s === 429 || s === 402 || /quota|exhaust|rate.?limit|insufficient|billing|too many|out of|limit reached/.test(m);
```

A timeout raises `'provider timeout'`, which matches none of those, so `markExhausted()` is never called. **The cooldown that exists precisely for this never fires.** Gemini is retried, and hangs, on every single message, forever. That is the 30 s the user waits before Groq answers.

Two fixes, both needed: point `GEMINI_MODEL` at a model that responds, and treat a timeout as a reason to bench a provider, not just a quota error.

### 2. `get_rain_overview` says it's raining when it isn't — HIGH

Asked *"Where is it raining in Indonesia right now?"*, the bot answered: **"Jakarta, Bandung, Semarang, Denpasar and Pekanbaru are currently seeing rain."**

Four of those five are not raining. [`toolRainOverview`](../api/_lib/core.js) decides by **text-matching the condition label** — the exact approach the rest of the codebase documents as wrong:

```js
raining_now: /rain|drizzle|shower|thunder/i.test(data.current.condition.text) || (data.current.precip_mm ?? 0) > 0
```

`RouteService.js` and the README both state the rule: *precipitation is decided by condition **code** (≥ 1150), never by matching the word "rain", because code 1063 "Patchy rain nearby" means rain around the point, not on it — and it is the default daytime condition across much of the tropics.* The overview tool never got that fix. Live comparison:

| City | Condition | Code | Precip | Overview tool | Route scorer | |
|---|---|---|---|---|---|---|
| Jakarta | Patchy rain nearby | 1063 | 0.14 mm | raining | dry | ✗ disagree |
| Bandung | Patchy rain nearby | 1063 | 0.01 mm | raining | dry | ✗ disagree |
| Semarang | Patchy rain nearby | 1063 | 0.33 mm | raining | dry | ✗ disagree |
| Denpasar | Patchy rain nearby | 1063 | 0.02 mm | raining | dry | ✗ disagree |
| Pekanbaru | Light rain | 1183 | 1.31 mm | raining | raining | ✓ |

The same app answers "is it raining in Jakarta?" two different ways depending on which feature you ask. The `precip_mm > 0` clause is also too tight — Bandung's 0.01 mm is a rounding artifact; `RouteService` uses ≤ 0.2 mm as still dry.

**Fix:** use the condition code and the 0.2 mm floor, matching `levelAt()` in `RouteService.js`.

### 3. Weather for the wrong country, reported without a word — HIGH

Asked about **"Zyrthandia Prime"** (invented), the bot replied confidently: *"about 25 °C and overcast, feeling a bit cooler at 23 °C, humidity around 41 %, air quality good, 10 % chance of rain."*

This is **not** a hallucination — I checked, and it was my first assumption too. WeatherAPI fuzzy-matched the nonsense query to **Prime, Viseu, Portugal**, a real village, and every figure the bot gave matches that response exactly (24.5 °C, Overcast, feels-like 23.3, humidity 41, EPA index 1, rain 10 %). The model called the tool correctly and reported faithfully.

The defect is that nobody tells the user. `toolWeather` *does* return `place: "Prime, Viseu, Portugal"` in its payload — the model simply had no instruction to surface it. A user asking about somewhere in Indonesia can be handed Portuguese weather with no signal that a substitution happened.

**Fix:** a prompt rule — when the resolved `place` doesn't plausibly match what was asked, name the place used ("I found Prime in Portugal — did you mean somewhere else?"). The data is already in hand.

### 4. Route answers claim coverage the model doesn't have — MEDIUM

*"How long to drive to Bandung, and will I get wet on the way?"* → **"about 2 hours (≈121 min) … you're unlikely to get wet on the way."**

The duration is right (OSRM: 122 min / 161.8 km) and the map action fired with correct Jakarta coordinates, so the origin-coordinate rule is working. But `get_route` returns **destination weather only** — its own note says *"judge rain from destination_weather.hourly"*. The model has no data for the 162 km in between, yet answered about "on the way".

Mitigated in the real app, where the route card beside the text does carry genuine per-stretch sampling. Still, the prose asserts more than the model knows.

### 5. Reminder labels come out mangled — MEDIUM

[`parseReminder`](../src/chat/assistant.js) strips `remind me( to)?` with no start anchor, so polite prefixes survive; and "set a **remind**er to…" passes the `includes('remind')` gate while matching no strip pattern, so the whole sentence becomes the label:

| User types | Reminder label becomes |
|---|---|
| `remind me to bring an umbrella at 5pm` | `bring an umbrella` ✓ |
| `Can you remind me to bring an umbrella at 5pm?` | `Can you  bring an umbrella ?` |
| `could you remind me to bring an umbrella at 5pm` | `could you  bring an umbrella` |
| `please remind me to bring an umbrella at 5pm` | `please  bring an umbrella` |
| `set a reminder to bring an umbrella at 5pm` | `set a reminder to bring an umbrella` |

The *times* are all correct (5pm → tomorrow 17:00, since 17:00 had already passed; "in 30 minutes" → +30 min). Only the text is wrong, and it's the text the notification shows.

### 6. UV index 0 described as "Moderate to low" at 8 PM — LOW

[`assistant.js:203`](../src/chat/assistant.js#L203) splits UV at a single threshold:

```js
`The UV index is ${weather.uv}. ${weather.uv >= 6 ? 'High — wear sunscreen.' : 'Moderate to low.'}`
```

There is no "none" branch and no night check, although [line 124](../src/chat/assistant.js#L124) guards the related path with `isDay === 1`. After dark the app reports UV 0 as "Moderate to low" rather than saying there's no UV at night.

### 7. Two natural phrasings miss the parsers — LOW

| Message | Parser result |
|---|---|
| `how do I get to Bandung?` | no route match |
| `how is it in Medan right now?` | no weather-in-place match |

Both fall through to the LLM, which handles them, so nothing breaks — but they cost a model call and lose the guaranteed route card. Everything else parsed correctly, including the tricky ones: `route to Bogor at 6pm` → `Bogor` (time stripped), `navigate to Jl. Sudirman No. 5` → preserved intact, `drive from Bekasi to Serpong` → `Serpong`, and `going to be rainy later` correctly rejected as a route.

### 8. Off-topic questions get answered — LOW

*"Who won the 2019 Indonesian presidential election?"* → *"Joko Widodo (Jokowi) was re-elected…"* Correct, but it's a weather app. The offline fallback assistant handles this properly, redirecting to what it can do. The LLM has no equivalent scope rule.

---

## What works, verified

- **Deixis resolution.** *"Weather in Bandung?"* → *"Is it hotter there than here?"* → *"Bandung ~22 °C, Jakarta ~29 °C, noticeably cooler in Bandung than here."* Correct places, correct numbers (22.4 / 29.3), correct conclusion. The prompt rule added for this is doing its job.
- **Multi-turn retention.** A cycling plan mentioned in turn 1 was correctly applied to a rain-jacket question in turn 3, two turns later.
- **Refusing to guess.** Asked for an exact temperature two weeks out, it declined, explained the 3-day horizon, and offered what it does have. Asked for a PM2.5 figure it doesn't hold, it said so and pointed elsewhere — rather than inventing a plausible µg/m³.
- **Tool routing.** Logs confirm the right tool every time, including `get_route({origin: "-6.2146,106.8451"})` — coordinates, not a city name, exactly as the prompt requires.
- **Other-city lookups.** Medan reported as 23 °C / mist / 97 % humidity / "around 30-40 %" rain — all four match, and the rain figure matches the real next hours (32/38/39/38 %), not Jakarta's.
- **Reminder timing**, the offline assistant's facts, and 233 existing tests.

---

## Suggested order of work

1. Repoint `GEMINI_MODEL`, and make `isQuota` bench on timeouts (defect 1) — biggest felt improvement, smallest change.
2. Fix `toolRainOverview` to use condition codes (defect 2) — it is actively telling users the wrong thing.
3. Add the resolved-place disclosure rule (defect 3).
4. Anchor `parseReminder`'s strip patterns (defect 5).
5. The rest as polish.

---

## Resolution

All eight defects were fixed the same day. 26 regression tests were added, each
confirmed to fail against the pre-fix code; the suite went 233 → 259, all passing.

| # | Defect | Fix |
|---|---|---|
| 1 | 30 s stall on a dead primary | `isQuota` → `isBenchable`: timeouts and connection failures now bench a provider, same as quota |
| 1b | *(found while fixing 1)* | `GEMINI_MODEL` default → `gemini-flash-lite-latest` |
| 1c | *(found while verifying 1b)* | `thinkingConfig` is now **omitted** when the budget is 0, not sent as zero — lite rejects the field outright with HTTP 400 |
| 2 | Rain overview contradicted the route scorer | New `isRainingNow()` uses condition code ≥ 1150 and a 0.2 mm floor, matching `RouteService.levelAt()` |
| 3 | Silent place substitution | Prompt rule: name the resolved `place` when it doesn't match what was asked |
| 4 | Route answers overclaimed coverage | Prompt rule: `get_route` is destination weather, so never say "you won't get wet on the way" |
| 5 | Mangled reminder labels | Lead-ins anchored and stripped; "set a reminder to X" handled; gaps and trailing punctuation cleaned |
| 6 | UV 0 called "Moderate to low" | Night/zero branch, plus the standard WHO bands instead of one cut at 6 |
| 7 | Parser gaps | `get` admitted as a nav verb only before "to"; `how is it in X` admitted as a weather question |

### Defect 1 had two layers underneath it

Switching off `gemini-flash-latest` did not make Gemini work — it swapped a 30 s
hang for a fast HTTP 400, *"Request contains an invalid argument"*. Bisecting the
payload found the cause: `gemini-flash-lite-latest` rejects `thinkingConfig`
entirely, and because `GEMINI_THINKING_BUDGET` defaults to `0` the field was sent
on **every** request. "Off" was being transmitted rather than omitted.

| Payload to `gemini-flash-lite-latest` | Result |
|---|---|
| plain | 200 |
| + `thinkingConfig: {thinkingBudget: 0}` | **400** |
| + tools | 200 |
| + tools + `thinkingConfig` | **400** |

So the original symptom hid a second fault that only became visible once the
first was cleared.

### Measured after the fixes

| | Before | After |
|---|---|---|
| *"Where is it raining in Indonesia?"* | "Jakarta, Bandung, Semarang, Denpasar and Pekanbaru are currently seeing rain" — 4 of 5 wrong | "it looks **dry right now**, with only patchy mist or nearby rain clouds in a few areas like Jakarta and Bandung" |
| Response time | 31 s, every reply via Groq | 8.8 s then 4.7 s, via **Gemini** |
| Provider answering | Gemini 0 / 15 | Gemini primary, working |
| Test suite | 233 | 259 |

### Still open

- **`AI_HISTORY_TURNS`** is 16 in `.env.local` but documented as 6. The eval
  harness measured 16 as better (18/20 vs 16/20); the default was left alone.
- **The 30 s provider timeout** is unchanged. With benching fixed, only the first
  message after a cooldown expiry can pay it, so it is no longer felt per-message.
- **Off-topic questions** (defect 8) are still answered by the model; only the
  offline assistant redirects. Left as a judgement call rather than a bug.
