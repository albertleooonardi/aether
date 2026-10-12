/*
 * AetherAI backend core — provider failover (Gemini/Groq), weather/route tools,
 * and geocode/route proxies. Framework-agnostic: every handler here takes plain
 * arguments and returns { status, body } so it can be served either by the local
 * dev server (server/index.js, node:http) or by Vercel serverless functions
 * (api/*.js), without duplicating logic.
 *
 * NOTE ON SERVERLESS: usage/cooldown tracking below is process-memory only. On
 * Vercel each function instance is short-lived and may be recycled between
 * requests, so daily token counters and provider cooldowns are best-effort in
 * production (they work as expected in the long-running local dev server).
 */
const path = require('path');
require('dotenv').config({
  path: [path.join(__dirname, '..', '..', '.env.local'), path.join(__dirname, '..', '..', '.env')],
});
const https = require('https');

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
// gemini-flash-lite-latest, not gemini-flash-latest: on the free tier the latter
// exhausts its daily quota almost immediately, and an exhausted tier does not
// always answer 429 — it was measured holding the socket open past the full 30s
// timeout, on every call. Lite draws on a separate quota bucket and answered in
// ~1s under the same key. Override with GEMINI_MODEL on a paid tier.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const WEATHER_KEY = process.env.WEATHER_API_KEY || process.env.REACT_APP_WEATHER_API_KEY || '';
// Supabase — chat-turn logging (debugging aid for the intent parser, not
// training data). SERVICE_KEY bypasses RLS, so it must never reach the
// browser; this module only runs server-side (dev server / Vercel function).
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const MAX_OUTPUT = Number(process.env.AI_MAX_OUTPUT_TOKENS || 450);
const HISTORY_TURNS = Number(process.env.AI_HISTORY_TURNS || 6);
const COOLDOWN_MS = Number(process.env.AI_COOLDOWN_MS || 30 * 60 * 1000);
const GEMINI_BUDGET = Number(process.env.GEMINI_TOKEN_BUDGET || 0);
const THINKING_BUDGET = Number(process.env.GEMINI_THINKING_BUDGET || 0);
const GROQ_BUDGET = Number(process.env.GROQ_TOKEN_BUDGET || 0);
const PRIMARY = (process.env.AI_PRIMARY || 'gemini').toLowerCase();
const ORDER = PRIMARY === 'groq' ? ['groq', 'gemini'] : ['gemini', 'groq'];

const META = {
  gemini: { label: 'Gemini', key: GEMINI_KEY, model: GEMINI_MODEL, budget: GEMINI_BUDGET },
  groq: { label: 'Groq', key: GROQ_KEY, model: GROQ_MODEL, budget: GROQ_BUDGET },
};

const SYSTEM = `You are AetherAI, the friendly assistant inside the "Aether" weather app.
Your job is to help people plan around the weather so they never get caught out.

APP WEATHER DATA (JSON, appended below) is live data from the app itself — the same
data its cards render. Treat it as ground truth:
- "location": current conditions at the city loaded in the app. All temperatures are
  °C, wind in km/h, pressure in mb, visibility in km. "aqi_us_epa" is the US EPA air
  quality index (1 good … 6 hazardous).
- "hourly_next_hours": the next ~12 hours (local time). Use these — not the daily
  number — for "later", "tonight", "this evening", "when should I leave" questions,
  and say WHEN (e.g. "rain picks up around 8 PM, 70%").
- "forecast_days": the next days. Use these for "tomorrow" / "this weekend".
- "displayed" (may be absent): what the user is looking at RIGHT NOW in the app.
  "displayed.route" is the route card above the conversation — origin, destination,
  when it was drawn, and "options", each a tappable row on that card (labels
  "Recommended", "Option 2", … exactly as shown) with distance_km, duration_min and
  rain (dry/light/wet). "displayed.reminders" are the user's pending reminders
  (label + local due time). If it is missing, nothing relevant is on screen.

TOOLS — you can call these for live data; prefer them over guessing or deflecting:
- get_weather(location): live current + hourly + 3-day forecast for ANY place (or
  "lat,lon"). Call it whenever the question involves a place that is not the loaded
  city — never answer about another place with the loaded city's numbers, and never
  tell the user to search themselves when you can look it up.
- get_rain_overview(locations[]): rain status for up to 12 places in one call. For
  "where is it raining" / "show me the rainy places today", choose ~8-10 major
  cities of the area the user means (no area named → the loaded city's country,
  starting with its own region) and call this once. Present the rainy ones as a
  short list; note it's a check of major cities, not everywhere.
- get_route(origin, destination): driving distance & time between two places plus
  the live forecast at the destination — use it for "rain on my way to X", travel
  planning, and "should I leave now or later" questions. If the user doesn't name
  an origin, pass the loaded city's coordinates as "lat,lon" from APP WEATHER DATA
  rather than its name — a bare city name can geocode to a same-named place far
  away, and the app draws the route map from whatever this resolves to.

Rules:
- Be concise, warm and practical: prose in 1–3 short sentences. NEVER write labelled
  field lists ("Route:", "Distance:", "Driving time:", "Rain outlook:") or a
  "Bottom line:" summary — a labelled block is wrong for this app because the cards
  already present structured data. Bold at most one key fact.
- Answer from APP WEATHER DATA whenever the question is about the loaded location
  and it covers the timeframe; call get_weather for anything it doesn't cover.
  Never invent numbers you weren't given.
- "here", "my place", "my location", "this city", and any question naming no place
  all mean the LOADED city in APP WEATHER DATA. Whenever that data is present you
  already know where "here" is — never ask the user what city they are in. If one
  message uses both, "there" is the place most recently discussed and "here" is the
  loaded city; answer the comparison directly instead of asking which is which.
- Every weather tool result carries a "place" field: the location the lookup
  ACTUALLY resolved to. The geocoder matches loosely and will silently substitute
  somewhere else — "Zyrthandia Prime" returned weather for Prime, Viseu, Portugal.
  If "place" is not plausibly the place the user asked about (different country or
  region, or a name that doesn't match), say which place you used and offer to try
  again, instead of reporting the numbers as though they were the right ones.
- get_route gives you the weather at the DESTINATION only, not along the road. Say
  what you know ("it's dry in Bandung when you'd arrive"), never "you won't get wet
  on the way" — the route card beside your reply is what covers the road itself.
- A route map is drawn automatically for any routing question. NEVER tell the user
  to rephrase to get one, and never offer "a map view" as though it were extra.
- When "displayed.route" is present, do not restate its distance, duration or
  endpoints — the user can see them. Answer what was ASKED about it. For "any other
  routes?", name the alternatives from displayed.route.options and point at the rows
  ("Option 2 is 36 km / 38 min and also dry — tap it on the card above").
- Reminders need a phrasing ("remind me to bring an umbrella at 5pm"), so you may
  suggest that when useful — but not when "displayed.reminders" already covers it.
  Use that list to answer "what did I ask you to remind me about?".
- You may explain general weather knowledge (what UV index means, dew point comfort,
  what an AQI level implies) and tie it back to the current numbers.
- Use **bold** sparingly: at most one key fact.`;

const contextText = (context) =>
  context && context.location
    ? `\n\nAPP WEATHER DATA (JSON): ${JSON.stringify(context)}`
    : '\n\nNo location is loaded in the app yet — the user should search a city first.';

// The app sends { role, text }, but an OpenAI-shaped { role, content } is what
// any curl probe or third-party client will send. Filtering on m.text alone
// dropped those silently: the request looked healthy (HTTP 200) while Gemini was
// called with an empty conversation, 400'd, and the failover answered a prompt
// containing no user text at all. Accept either key, and normalise onto `text`
// so the two provider call sites keep reading one field.
const trimmed = (messages) =>
  (Array.isArray(messages) ? messages : [])
    .slice(-HISTORY_TURNS)
    .map((m) => m && { ...m, text: m.text || m.content })
    .filter((m) => m && m.text);

/* ---------------- AI tools: live weather + routing for the model ---------------- */
const TOOL_DEFS = [
  {
    name: 'get_weather',
    description:
      'Live weather for any place: current conditions, hourly forecast (~next 12h) and 3-day outlook. Location can be a city/area name or "lat,lon".',
    parameters: {
      type: 'object',
      properties: { location: { type: 'string', description: 'City, area, or "lat,lon"' } },
      required: ['location'],
    },
  },
  {
    name: 'get_rain_overview',
    description:
      'Rain snapshot for several places at once (up to 12): condition, whether it is raining right now, and today\'s rain chance for each. Use for "where is it raining", "list the rainy cities in <country/region>" — pick the major cities of that area yourself and check them in one call.',
    parameters: {
      type: 'object',
      properties: {
        locations: {
          type: 'array',
          items: { type: 'string' },
          description: 'Up to 12 place names, e.g. major cities of the region asked about',
        },
      },
      required: ['locations'],
    },
  },
  {
    name: 'get_route',
    description:
      'Driving route between two places: distance, duration, and the live forecast at the destination (hourly, so rain at arrival time can be judged).',
    parameters: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Starting place name or "lat,lon"' },
        destination: { type: 'string', description: 'Destination place name or "lat,lon"' },
      },
      required: ['origin', 'destination'],
    },
  },
];

async function toolWeather(q) {
  if (!WEATHER_KEY) return { error: 'no weather api key configured' };
  const { status, data } = await fetchJSON(
    `https://api.weatherapi.com/v1/forecast.json?key=${WEATHER_KEY}&q=${encodeURIComponent(q)}&days=3&aqi=yes`
  );
  if (status !== 200 || !data || !data.location) return { error: `no weather found for "${q}"` };
  const now = data.location.localtime_epoch;
  const hourly = (data.forecast?.forecastday || [])
    .flatMap((d) => d.hour || [])
    .filter((h) => h.time_epoch >= now - 3600)
    .slice(0, 12)
    .map((h) => ({ time: h.time, temp_c: Math.round(h.temp_c), condition: h.condition.text, rain_pct: h.chance_of_rain ?? 0 }));
  return {
    place: [data.location.name, data.location.region, data.location.country].filter(Boolean).join(', '),
    localtime: data.location.localtime,
    current: {
      temp_c: Math.round(data.current.temp_c),
      feels_like_c: Math.round(data.current.feelslike_c),
      condition: data.current.condition.text,
      humidity_pct: data.current.humidity,
      wind_kph: data.current.wind_kph,
      uv: data.current.uv,
      aqi_us_epa: data.current.air_quality?.['us-epa-index'] ?? null,
    },
    hourly,
    days: (data.forecast?.forecastday || []).map((d) => ({
      date: d.date,
      high_c: Math.round(d.day.maxtemp_c),
      low_c: Math.round(d.day.mintemp_c),
      condition: d.day.condition.text,
      rain_pct: d.day.daily_chance_of_rain ?? 0,
    })),
  };
}

// Is precipitation actually falling HERE, right now?
//
// This is the same rule RouteService.levelAt() applies, and it has to be: the
// app cannot answer "is it raining in Jakarta?" one way on the route card and
// another way in the chat. The previous test here was
//   /rain|drizzle|shower|thunder/.test(condition.text) || precip_mm > 0
// which is exactly the text match RouteService documents as wrong. It counted
// code 1063 "Patchy rain nearby" — rain AROUND the point, not on it, and the
// default daytime condition across much of the tropics — so a live check named
// Jakarta, Bandung, Semarang and Denpasar as raining while the route scorer in
// the same app called all four dry.
//
// The amount floor matches too: RouteService treats ≤0.2mm as dry, because a
// trace reading like Bandung's 0.01mm is a rounding artifact, not weather.
const RAIN_CODE_MIN = 1150;
const TRACE_MM = 0.2;
const isRainingNow = (current) =>
  (current?.condition?.code ?? 0) >= RAIN_CODE_MIN || (current?.precip_mm ?? 0) > TRACE_MM;

async function toolRainOverview(locations) {
  if (!WEATHER_KEY) return { error: 'no weather api key configured' };
  const list = (Array.isArray(locations) ? locations : []).slice(0, 12);
  if (!list.length) return { error: 'no locations given' };
  const results = await Promise.all(
    list.map(async (q) => {
      try {
        const { status, data } = await fetchJSON(
          `https://api.weatherapi.com/v1/forecast.json?key=${WEATHER_KEY}&q=${encodeURIComponent(q)}&days=1`
        );
        if (status !== 200 || !data || !data.location) return { place: q, error: 'not found' };
        const day = data.forecast?.forecastday?.[0]?.day;
        return {
          place: [data.location.name, data.location.region].filter(Boolean).join(', '),
          condition: data.current.condition.text,
          raining_now: isRainingNow(data.current),
          rain_chance_today_pct: day?.daily_chance_of_rain ?? null,
          temp_c: Math.round(data.current.temp_c),
        };
      } catch {
        return { place: q, error: 'lookup failed' };
      }
    })
  );
  return { note: 'covers only the places checked, not everywhere', results };
}

async function geocodeOne(q, near) {
  const asCoords = coords(q);
  if (asCoords) return { name: q, label: q, ...asCoords };
  for (const lookup of [viaPhoton, viaNominatim]) {
    try {
      const list = await lookup(q, near);
      if (list.length) return list[0];
    } catch {
      /* try the next provider */
    }
  }
  return null;
}

async function toolRoute(originQ, destQ, context, onRoute) {
  const loc = context && context.location;
  const near = loc && Number.isFinite(loc.lat) ? { lat: loc.lat, lon: loc.lon } : null;

  // The loaded city's exact coordinates are already in APP WEATHER DATA, so
  // geocoding its NAME is a lossy round trip — and a losing one: the model often
  // passes "Ciater Udik" rather than "-6.3,106.65", and the geocoder has resolved
  // that to a same-named road 700km away in East Java, which then draws a route
  // map from entirely the wrong origin. Use the coordinates we already hold
  // whenever the origin is omitted or is just the loaded city by name.
  const named = (originQ || '').trim().toLowerCase();
  const asCoords = coords(originQ);
  // Now that the prompt asks for "lat,lon", the model usually sends exactly the
  // loaded city's coordinates — which would otherwise label the route map
  // "-6.3,106.65" instead of "Ciater Udik". Treat coordinates within ~1km of the
  // loaded city as the loaded city, so the card shows a place name.
  const nearLoaded =
    near && asCoords && Math.abs(asCoords.lat - near.lat) < 0.01 && Math.abs(asCoords.lon - near.lon) < 0.01;
  const isLoadedCity =
    near && (!named || named === String(loc.city || '').toLowerCase() || nearLoaded);

  const o = isLoadedCity
    ? { name: loc.city, label: [loc.city, loc.region, loc.country].filter(Boolean).join(', '), ...near }
    : await geocodeOne(originQ, near);
  if (!o) return { error: `could not find origin "${originQ}"` };
  const d = await geocodeOne(destQ, near || o);
  if (!d) return { error: `could not find destination "${destQ}"` };
  const { status, data } = await fetchJSON(
    `https://router.project-osrm.org/route/v1/driving/${o.lon},${o.lat};${d.lon},${d.lat}?overview=false`
  );
  if (status !== 200 || !data || data.code !== 'Ok' || !data.routes?.length) {
    return { error: `no driving route found from "${o.label}" to "${d.label}"` };
  }
  const r = data.routes[0];
  const durationMin = Math.round(r.duration / 60);
  const destWeather = await toolWeather(`${d.lat},${d.lon}`);
  // Coordinates go to the collector only, never into the object below: the
  // model has no use for lat/lon and would only recite them at the user.
  if (onRoute) {
    onRoute({
      kind: 'route',
      origin: { name: o.name, lat: o.lat, lon: o.lon },
      dest: { name: d.name, lat: d.lat, lon: d.lon },
    });
  }
  return {
    origin: o.label,
    destination: d.label,
    distance_km: Math.round(r.distance / 100) / 10,
    duration_min: durationMin,
    note: `arrival is ~${durationMin} min after departure — judge rain from destination_weather.hourly around that time`,
    destination_weather: destWeather,
  };
}

async function execTool(name, args, context, actions) {
  console.log(`[tool] ${name}(${JSON.stringify(args)})`);
  try {
    if (name === 'get_weather') return await toolWeather(String(args.location || ''));
    if (name === 'get_rain_overview') return await toolRainOverview(args.locations);
    if (name === 'get_route') {
      // Reserve the slot before awaiting so parallel calls keep call order
      // (not completion order); a failed route leaves the slot null.
      const slot = actions ? actions.push(null) - 1 : -1;
      return await toolRoute(String(args.origin || ''), String(args.destination || ''), context, (a) => {
        if (slot >= 0) actions[slot] = a;
      });
    }
    return { error: `unknown tool "${name}"` };
  } catch (e) {
    return { error: e.message || 'tool failed' };
  }
}

const MAX_TOOL_STEPS = 4;

/* ---------------- token usage tracking (per provider, daily; best-effort on serverless) ---------------- */
const today = () => new Date().toISOString().slice(0, 10);
const blank = () => ({ calls: 0, prompt: 0, completion: 0, total: 0, exhaustedUntil: 0, lastError: null });
let usageDay = today();
const usage = { gemini: blank(), groq: blank() };

const rollDay = () => {
  const d = today();
  if (d !== usageDay) {
    usageDay = d;
    usage.gemini = blank();
    usage.groq = blank();
  }
};
const hasKey = (p) => !!META[p].key;
const available = (p) => {
  rollDay();
  if (!hasKey(p)) return false;
  if (usage[p].exhaustedUntil > Date.now()) return false;
  if (META[p].budget > 0 && usage[p].total >= META[p].budget) return false;
  return true;
};
const record = (p, u) => {
  rollDay();
  const x = usage[p];
  x.calls += 1;
  x.prompt += u.prompt || 0;
  x.completion += u.completion || 0;
  x.total += u.total || 0;
};
const markExhausted = (p, msg) => {
  usage[p].exhaustedUntil = Date.now() + COOLDOWN_MS;
  usage[p].lastError = msg;
};
// Reasons to SIDELINE a provider rather than retry it on the next message.
//
// Quota is the obvious one. The other is a provider that accepts the connection
// and then never answers: measured, `gemini-flash-latest` held the socket open
// past the 30s timeout on every call while the same key answered in 1.6s on
// gemini-flash-lite-latest. A timeout raises 'provider timeout', which matched
// none of the quota signatures, so markExhausted() was never called and the
// dead primary was retried — and hung — on EVERY message, indefinitely. The
// user paid the full 30s before the backup answered, forever.
//
// A hang is in fact the most expensive failure there is (a 429 costs
// milliseconds; a hang costs the whole timeout), so it is the LAST thing that
// should be exempt from the cooldown. Connection-level failures go here too:
// a provider that is refusing or unreachable will not recover within one turn.
const isBenchable = (e) => {
  const s = e.status;
  const m = (e.message || '').toLowerCase();
  if (s === 429 || s === 402) return true;
  if (/quota|exhaust|rate.?limit|insufficient|billing|too many|out of|limit reached/.test(m)) return true;
  return /timeout|timed out|socket hang up|econnreset|econnrefused|enotfound|network|fetch failed/.test(m);
};

const snapshot = () => {
  rollDay();
  const snap = (p) => ({
    label: META[p].label,
    model: META[p].model,
    hasKey: hasKey(p),
    available: available(p),
    exhausted: usage[p].exhaustedUntil > Date.now(),
    cooldownEndsAt: usage[p].exhaustedUntil || null,
    calls: usage[p].calls,
    tokens: usage[p].total,
    promptTokens: usage[p].prompt,
    completionTokens: usage[p].completion,
    budget: META[p].budget || null,
    lastError: usage[p].lastError,
  });
  return {
    day: usageDay,
    primary: PRIMARY,
    totalTokens: usage.gemini.total + usage.groq.total,
    gemini: snap('gemini'),
    groq: snap('groq'),
  };
};

/* ---------------- HTTP helpers ---------------- */
function httpsPostJSON(hostname, reqPath, payload, headers) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(
      {
        hostname,
        path: reqPath,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...(headers || {}) },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(body || '{}') });
          } catch {
            resolve({ status: res.statusCode, json: {} });
          }
        });
      }
    );
    req.setTimeout(30000, () => req.destroy(new Error('provider timeout')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function fetchJSON(url, headers, timeoutMs = 8000) {
  const res = await fetch(url, { headers: headers || {}, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { status: res.status, data };
}

/* ---------------- provider calls (return { text, usage }) ---------------- */
async function callGemini(messages, context, actions) {
  const contents = trimmed(messages).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.text }],
  }));
  const used = { prompt: 0, completion: 0, total: 0 };

  for (let step = 0; step <= MAX_TOOL_STEPS; step++) {
    const payload = {
      system_instruction: { parts: [{ text: SYSTEM + contextText(context) }] },
      contents,
      tools: [{ functionDeclarations: TOOL_DEFS }],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: MAX_OUTPUT,
        // "off" has to mean OMITTED, not sent as zero. Not every Gemini model
        // accepts thinkingConfig at all: gemini-flash-lite-latest rejects the
        // whole request with 400 "Request contains an invalid argument" when the
        // field is present, even set to 0 — and since the budget defaults to 0,
        // the field was always being sent, so that model could never answer.
        ...(THINKING_BUDGET > 0 ? { thinkingConfig: { thinkingBudget: THINKING_BUDGET } } : {}),
      },
    };
    const { status, json: body } = await httpsPostJSON(
      'generativelanguage.googleapis.com',
      `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
      payload
    );
    if (status !== 200) {
      const e = new Error(body && body.error ? body.error.message : `Gemini HTTP ${status}`);
      e.status = status;
      throw e;
    }
    const u = body.usageMetadata || {};
    used.prompt += u.promptTokenCount || 0;
    used.completion += u.candidatesTokenCount || 0;
    used.total += u.totalTokenCount || 0;

    const parts = body.candidates?.[0]?.content?.parts || [];
    const calls = parts.filter((p) => p.functionCall);
    if (!calls.length || step === MAX_TOOL_STEPS) {
      const text = parts.map((p) => p.text || '').join('').trim();
      if (!text) throw new Error('Empty response from Gemini');
      return { text, usage: used };
    }
    contents.push({ role: 'model', parts });
    const results = await Promise.all(
      calls.map(async (p) => ({
        functionResponse: {
          name: p.functionCall.name,
          response: await execTool(p.functionCall.name, p.functionCall.args || {}, context, actions),
        },
      }))
    );
    contents.push({ role: 'user', parts: results });
  }
  throw new Error('Gemini tool loop exceeded');
}

async function callGroq(messages, context, actions) {
  const msgs = [{ role: 'system', content: SYSTEM + contextText(context) }].concat(
    trimmed(messages).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text }))
  );
  const used = { prompt: 0, completion: 0, total: 0 };

  for (let step = 0; step <= MAX_TOOL_STEPS; step++) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: msgs,
        temperature: 0.6,
        max_tokens: MAX_OUTPUT,
        ...(step < MAX_TOOL_STEPS
          ? { tools: TOOL_DEFS.map((t) => ({ type: 'function', function: t })) }
          : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status !== 200) {
      const e = new Error(data && data.error ? data.error.message : `Groq HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    const u = data.usage || {};
    used.prompt += u.prompt_tokens || 0;
    used.completion += u.completion_tokens || 0;
    used.total += u.total_tokens || 0;

    const m = data.choices?.[0]?.message || {};
    if (!m.tool_calls || !m.tool_calls.length) {
      const text = (m.content || '').trim();
      if (!text) throw new Error('Empty response from Groq');
      return { text, usage: used };
    }
    msgs.push(m);
    for (const tc of m.tool_calls) {
      let args = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        /* leave empty */
      }
      msgs.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(await execTool(tc.function.name, args, context, actions)),
      });
    }
  }
  throw new Error('Groq tool loop exceeded');
}

async function generate(messages, context) {
  let order = ORDER.filter(available);
  if (!order.length) order = ORDER.filter(hasKey);
  if (!order.length) {
    const e = new Error('no_provider');
    e.code = 'no_key';
    throw e;
  }
  let lastErr;
  for (const p of order) {
    try {
      // Per request AND per provider attempt: a failed-over provider's tool
      // calls must not leak into the answer the next provider writes.
      const collected = [];
      const out =
        p === 'gemini'
          ? await callGemini(messages, context, collected)
          : await callGroq(messages, context, collected);
      record(p, out.usage);
      // Dedupe by endpoint coordinates keeping the LAST (the one the final
      // answer is based on); omit the key entirely when empty.
      const key = (a) => `${a.origin.lat},${a.origin.lon};${a.dest.lat},${a.dest.lon}`;
      const byKey = new Map();
      for (const a of collected.filter(Boolean)) {
        byKey.delete(key(a));
        byKey.set(key(a), a);
      }
      const actions = [...byKey.values()].slice(-1);
      return {
        reply: out.text,
        provider: p,
        model: META[p].model,
        usage: snapshot(),
        ...(actions.length ? { actions } : {}),
      };
    } catch (e) {
      lastErr = e;
      if (isBenchable(e)) markExhausted(p, e.message);
      else usage[p].lastError = e.message;
    }
  }
  throw lastErr || new Error('all_providers_failed');
}

/* ---------------- geocode + routing proxies ---------------- */
const PHOTON = 'https://photon.komoot.io/api';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

const coords = (near) => {
  const p = (near || '').split(',').map(Number);
  return p.length === 2 && p.every(Number.isFinite) ? { lat: p[0], lon: p[1] } : null;
};

const VIEW_DEG = 3;

const viewboxOf = (c) =>
  c ? `&viewbox=${c.lon - VIEW_DEG},${c.lat - VIEW_DEG},${c.lon + VIEW_DEG},${c.lat + VIEW_DEG}` : '';

const distanceKm = (a, b) => {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(a.lat * rad) * Math.cos(b.lat * rad);
  return 2 * R * Math.asin(Math.sqrt(h));
};

const NEAR_DUPLICATE_KM = 0.4;

// Two entries reading exactly "Grand Orchard, Jakarta, Indonesia" are not a
// choice the user can make — whatever distinguishes them isn't on screen, so
// picking is a coin flip. Identical labels collapse no matter how far apart they
// sit; only the highest-ranked survives.
const sameLabel = (a, b) => (a.label || a.name || '').toLowerCase() === (b.label || b.name || '').toLowerCase();

const dedupe = (list) =>
  list.reduce((keep, c) => {
    if (!keep.some((k) => distanceKm(k, c) < NEAR_DUPLICATE_KM || sameLabel(k, c))) keep.push(c);
    return keep;
  }, []);

async function viaPhoton(q, c) {
  const bias = c ? `&lat=${c.lat}&lon=${c.lon}` : '';
  const { status, data } = await fetchJSON(`${PHOTON}?q=${encodeURIComponent(q)}&limit=20&lang=en${bias}`, {
    'User-Agent': 'AetherAI/1.0 (Aether weather app)',
  });
  if (status !== 200 || !data || !Array.isArray(data.features)) return [];
  return data.features
    .map((f) => {
      const p = f.properties || {};
      const [lon, lat] = f.geometry.coordinates;
      const name = p.name || p.street || p.city;
      if (!name || !Number.isFinite(lat)) return null;
      return { name, label: [name, p.city || p.state, p.country].filter(Boolean).join(', '), lat, lon };
    })
    .filter(Boolean);
}

async function viaNominatim(q, c) {
  const { status, data } = await fetchJSON(
    `${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&limit=20${viewboxOf(c)}`,
    { 'User-Agent': 'AetherAI/1.0 (Aether weather app)', Accept: 'application/json' }
  );
  if (status !== 200 || !Array.isArray(data) || !data.length) return [];
  return [...data]
    .sort((a, b) => (b.importance || 0) - (a.importance || 0))
    .map((l) => {
      const label = l.display_name.split(',').slice(0, 2).join(',').trim();
      return { name: l.name || label, label, lat: parseFloat(l.lat), lon: parseFloat(l.lon) };
    });
}

// Photon indexes POIs far better, Nominatim is stronger on plain place names —
// so both are consulted and merged (Photon first, keeping its ranking on top)
// rather than letting whichever answers first end the search. Dedupe collapses
// a POI and its own sub-features, so the raw lists are much longer than `limit`.
const GEOCODE_LIMIT = 10;
const GEOCODE_MAX = 20;

async function geocodeHandler(q, near, limit) {
  if (!q) return { status: 400, body: { error: 'missing_q' } };
  const c = coords(near);
  const want = Math.min(Number(limit) || GEOCODE_LIMIT, GEOCODE_MAX);

  const found = [];
  for (const lookup of [viaPhoton, viaNominatim]) {
    try {
      found.push(...(await lookup(q, c)));
    } catch {
      /* try the next provider */
    }
    if (dedupe(found).length >= want) break;
  }

  const candidates = dedupe(found).slice(0, want);
  if (!candidates.length) return { status: 404, body: { error: 'not_found' } };
  return { status: 200, body: { candidates } };
}

/* ---------------- Google Maps short links ---------------- */
const COORD_PATTERNS = [
  /@(-?\d+\.\d+),(-?\d+\.\d+)/,
  /[?&](?:q|ll|sll|daddr|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
  /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
];

const placeNameOf = (url) => {
  const m = url.match(/\/maps\/place\/([^/@]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' ')).trim() || null;
  } catch {
    return null;
  }
};

const coordsIn = (url) => {
  for (const re of COORD_PATTERNS) {
    const m = url.match(re);
    if (!m) continue;
    const lat = parseFloat(m[1]);
    const lon = parseFloat(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      const name = placeNameOf(url);
      return { name: name || 'Dropped pin', label: name || 'Google Maps pin', lat, lon };
    }
  }
  return null;
};

const MAPS_HOST = /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)/i;

async function resolveHandler(url) {
  if (!url) return { status: 400, body: { error: 'missing_url' } };
  if (!MAPS_HOST.test(url)) return { status: 400, body: { error: 'not_a_maps_link' } };

  const direct = coordsIn(url);
  if (direct) return { status: 200, body: direct };

  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (AetherAI)' } });
    const hit = coordsIn(r.url) || coordsIn(await r.text());
    if (hit) return { status: 200, body: hit };
  } catch {
    /* fall through */
  }
  return { status: 404, body: { error: 'not_found' } };
}

// Worst-case wall time of routeHandler: every attempt times out, with a backoff
// between attempts (none after the last). The browser's budget for /api/route
// (ROUTE_PROXY_TIMEOUT_MS in src/services/config.js) MUST stay above this, or the
// client abandons a proxy that is still retrying and falls back to calling public
// OSRM directly from the browser. src/services/RouteService.test.js asserts the
// relationship. 2 x 6s + 0.4s = 12.4s (was 3 x 8s + backoff, ~26s).
const ROUTE_ATTEMPTS = 2;
const ROUTE_ATTEMPT_TIMEOUT_MS = 6000;
const ROUTE_BACKOFF_MS = 400;
const ROUTE_PROXY_WORST_CASE_MS =
  ROUTE_ATTEMPTS * ROUTE_ATTEMPT_TIMEOUT_MS + ROUTE_BACKOFF_MS * ((ROUTE_ATTEMPTS * (ROUTE_ATTEMPTS - 1)) / 2);

async function routeHandler(from, to) {
  const f = (from || '').split(',');
  const t = (to || '').split(',');
  if (f.length !== 2 || t.length !== 2) return { status: 400, body: { error: 'bad_coords' } };
  const url = `https://router.project-osrm.org/route/v1/driving/${f[1]},${f[0]};${t[1]},${t[0]}?alternatives=true&overview=full&geometries=geojson&annotations=duration`;
  for (let attempt = 0; attempt < ROUTE_ATTEMPTS; attempt++) {
    try {
      const { status, data } = await fetchJSON(url, undefined, ROUTE_ATTEMPT_TIMEOUT_MS);
      if (status === 200 && data && data.code === 'Ok') return { status: 200, body: data };
      if (data && data.code) return { status: 200, body: data };
    } catch {
      /* retry */
    }
    if (attempt < ROUTE_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, ROUTE_BACKOFF_MS * (attempt + 1)));
  }
  return { status: 502, body: { error: 'routing_unavailable' } };
}

/* ---------------- top-level handlers ---------------- */
function healthHandler() {
  return {
    status: 200,
    body: {
      ok: true,
      ai: hasKey('gemini') || hasKey('groq'),
      providers: { gemini: hasKey('gemini'), groq: hasKey('groq') },
      primary: PRIMARY,
    },
  };
}

function usageHandler() {
  return { status: 200, body: snapshot() };
}

async function chatHandler(body) {
  const { messages = [], context = null } = body || {};
  if (!hasKey('gemini') && !hasKey('groq')) return { status: 200, body: { error: 'no_key' } };
  // Nothing to answer: don't spend a provider call (and a failover) on it.
  if (!trimmed(messages).length) return { status: 400, body: { error: 'no_messages' } };
  try {
    const out = await generate(messages, context);
    return { status: 200, body: out };
  } catch (e) {
    return { status: 200, body: { error: e.code === 'no_key' ? 'no_key' : e.message || 'ai_error' } };
  }
}

/* ---------------- chat-turn logging (Supabase, fire-and-forget) ---------------- */
const LOG_MESSAGE_MAX = 2000;

// chat_log exists to debug the intent parser (which handler answered a turn,
// and whether it succeeded), not to build a location history — so lat/lon is
// stripped out of `parsed` no matter how deep it's nested (e.g. a route's
// { origin: { lat, lon } }). City NAMEs pass through untouched.
const COORD_KEYS = new Set(['lat', 'lon', 'lng', 'latitude', 'longitude']);
const stripCoords = (value) => {
  if (Array.isArray(value)) return value.map(stripCoords);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !COORD_KEYS.has(k.toLowerCase()))
        .map(([k, v]) => [k, stripCoords(v)])
    );
  }
  return value;
};

// Telemetry, not a feature: every failure here (no env vars, table not
// created yet, network error, any Supabase 4xx/5xx) is swallowed and this
// always resolves 204 — a broken or absent logging backend must never surface
// to the chat UI or delay a reply.
async function logHandler(body) {
  // Same no-op degradation as the missing-AI-key path: nothing configured,
  // nothing attempted.
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return { status: 204, body: {} };
  try {
    const b = body || {};
    const row = {
      session_id: typeof b.session_id === 'string' ? b.session_id : null,
      message: typeof b.message === 'string' ? b.message.slice(0, LOG_MESSAGE_MAX) : null,
      handler: typeof b.handler === 'string' ? b.handler : null,
      parsed: b.parsed && typeof b.parsed === 'object' ? stripCoords(b.parsed) : null,
      outcome: typeof b.outcome === 'string' ? b.outcome : null,
      city: typeof b.city === 'string' ? b.city : null,
      provider: typeof b.provider === 'string' ? b.provider : null,
      latency_ms: Number.isFinite(b.latency_ms) ? b.latency_ms : null,
    };
    await fetch(`${SUPABASE_URL}/rest/v1/chat_log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* fire-and-forget: a Supabase outage or a not-yet-created table must never break chat */
  }
  return { status: 204, body: {} };
}

module.exports = {
  hasKey,
  trimmed,
  ORDER,
  META,
  // Exported for the regression tests: both decide something the app must not
  // get wrong twice (which failures bench a provider; what counts as rain).
  isBenchable,
  isRainingNow,
  healthHandler,
  usageHandler,
  chatHandler,
  geocodeHandler,
  resolveHandler,
  routeHandler,
  ROUTE_PROXY_WORST_CASE_MS,
  logHandler,
};
