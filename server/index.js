/*
 * AetherAI backend — keeps the AI keys server-side and proxies chat + geocode +
 * routing for the app. No external deps: Node built-ins + dotenv.
 *
 *   Run:  npm run server   (listens on :3001; CRA dev server proxies /api → here)
 *
 * Providers (failover + token management):
 *   - Gemini (primary)  GEMINI_API_KEY, GEMINI_MODEL=gemini-flash-latest
 *   - Groq   (backup)   GROQ_API_KEY,   GROQ_MODEL=llama-3.3-70b-versatile
 * If the primary is rate-limited / out of quota, requests switch to the backup.
 */
const path = require('path');
// CRA keeps the real keys in .env.local; dotenv's default only reads .env, so
// the backend used to boot key-less ("basic mode") while the keys sat right
// there. Load both, .env.local first (it wins), anchored to the project root
// so it works no matter where the server is started from.
require('dotenv').config({
  path: [path.join(__dirname, '..', '.env.local'), path.join(__dirname, '..', '.env')],
});
const http = require('http');
const https = require('https');

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
// Default to the smart-but-affordable tier, not the lite one: gemini-flash-latest
// (2.5 Flash) and Llama 3.3 70B. Reply length / history caps below keep token
// spend bounded regardless of model.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const GROQ_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
// The same WeatherAPI key the frontend uses — lets the AI fetch live weather
// for any place the user asks about, not just the loaded city.
const WEATHER_KEY = process.env.WEATHER_API_KEY || process.env.REACT_APP_WEATHER_API_KEY || '';

// Token-efficiency knobs.
const MAX_OUTPUT = Number(process.env.AI_MAX_OUTPUT_TOKENS || 450); // cap reply length (lists need room)
const HISTORY_TURNS = Number(process.env.AI_HISTORY_TURNS || 6); // trim prompt
const COOLDOWN_MS = Number(process.env.AI_COOLDOWN_MS || 30 * 60 * 1000); // sideline exhausted provider
// Optional daily token budgets per provider (0 = unlimited). When exceeded, the
// provider is skipped until the daily reset.
const GEMINI_BUDGET = Number(process.env.GEMINI_TOKEN_BUDGET || 0);
const GROQ_BUDGET = Number(process.env.GROQ_TOKEN_BUDGET || 0);
const PRIMARY = (process.env.AI_PRIMARY || 'gemini').toLowerCase();
const ORDER = PRIMARY === 'groq' ? ['groq', 'gemini'] : ['gemini', 'groq'];
const PORT = process.env.PORT || 3001;

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
  an origin, use the loaded city.

Rules:
- Be concise, warm and practical. Usually 1–3 sentences.
- Answer from APP WEATHER DATA whenever the question is about the loaded location
  and it covers the timeframe; call get_weather for anything it doesn't cover.
  Never invent numbers you weren't given.
- The app can also render rich route maps ("route from A to B") and set reminders
  ("remind me to bring an umbrella at 5pm"). Mention those phrasings when helpful.
- You may explain general weather knowledge (what UV index means, dew point comfort,
  what an AQI level implies) and tie it back to the current numbers.
- Use **bold** sparingly for the key fact.`;

const contextText = (context) =>
  context && context.location
    ? `\n\nAPP WEATHER DATA (JSON): ${JSON.stringify(context)}`
    : '\n\nNo location is loaded in the app yet — the user should search a city first.';

const trimmed = (messages) => messages.slice(-HISTORY_TURNS).filter((m) => m && m.text);

/* ---------------- AI tools: live weather + routing for the model ----------------
 * Both providers get the same two functions. Results are compacted hard — the
 * model reads them once per call, so every field is a token spent. */
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

// One cheap forecast call per place, in parallel — the model picks the places.
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
          raining_now:
            /rain|drizzle|shower|thunder/i.test(data.current.condition.text) || (data.current.precip_mm ?? 0) > 0,
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

// First geocode hit, biased near the loaded city when we know it.
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

async function toolRoute(originQ, destQ, context) {
  const loc = context && context.location;
  const near = loc && Number.isFinite(loc.lat) ? { lat: loc.lat, lon: loc.lon } : null;
  const o = await geocodeOne(originQ, near);
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
  return {
    origin: o.label,
    destination: d.label,
    distance_km: Math.round(r.distance / 100) / 10,
    duration_min: durationMin,
    note: `arrival is ~${durationMin} min after departure — judge rain from destination_weather.hourly around that time`,
    destination_weather: destWeather,
  };
}

async function execTool(name, args, context) {
  console.log(`[tool] ${name}(${JSON.stringify(args)})`);
  try {
    if (name === 'get_weather') return await toolWeather(String(args.location || ''));
    if (name === 'get_rain_overview') return await toolRainOverview(args.locations);
    if (name === 'get_route') return await toolRoute(String(args.origin || ''), String(args.destination || ''), context);
    return { error: `unknown tool "${name}"` };
  } catch (e) {
    return { error: e.message || 'tool failed' };
  }
}

// A model that keeps requesting tools past this is looping, not researching.
const MAX_TOOL_STEPS = 4;

/* ---------------- token usage tracking (per provider, daily) ---------------- */
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
const isQuota = (e) => {
  const s = e.status;
  const m = (e.message || '').toLowerCase();
  return s === 429 || s === 402 || /quota|exhaust|rate.?limit|insufficient|billing|too many|out of|limit reached/.test(m);
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
function httpsPostJSON(hostname, path, payload, headers) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(
      {
        hostname,
        path,
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
    // A provider that stalls must fail fast enough for the failover (and the
    // client's own timeout) to still be worth something.
    req.setTimeout(30000, () => req.destroy(new Error('provider timeout')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function fetchJSON(url, headers) {
  // Upstreams (geocoders, OSRM, WeatherAPI) occasionally hang rather than fail;
  // inside an AI tool call that stalls the whole chat reply, so cap every hop.
  const res = await fetch(url, { headers: headers || {}, signal: AbortSignal.timeout(8000) });
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
async function callGemini(messages, context) {
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
        // 2.5 Flash thinks by default, and thinking tokens count against
        // maxOutputTokens — replies came back truncated mid-sentence with the
        // whole budget spent reasoning. Weather Q&A doesn't need it; off also
        // means fewer tokens billed.
        thinkingConfig: { thinkingBudget: Number(process.env.GEMINI_THINKING_BUDGET || 0) },
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
    // Run the requested tools and hand the results back for the next turn.
    contents.push({ role: 'model', parts });
    const results = await Promise.all(
      calls.map(async (p) => ({
        functionResponse: {
          name: p.functionCall.name,
          response: await execTool(p.functionCall.name, p.functionCall.args || {}, context),
        },
      }))
    );
    contents.push({ role: 'user', parts: results });
  }
  throw new Error('Gemini tool loop exceeded'); // unreachable; loop returns
}

async function callGroq(messages, context) {
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
        // Past the step cap, stop offering tools so the model must answer.
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
        content: JSON.stringify(await execTool(tc.function.name, args, context)),
      });
    }
  }
  throw new Error('Groq tool loop exceeded'); // unreachable; loop returns
}

// Try providers in order, switching on quota/rate-limit errors.
async function generate(messages, context) {
  let order = ORDER.filter(available);
  if (!order.length) order = ORDER.filter(hasKey); // last resort: ignore cooldown/budget
  if (!order.length) {
    const e = new Error('no_provider');
    e.code = 'no_key';
    throw e;
  }
  let lastErr;
  for (const p of order) {
    try {
      const out = p === 'gemini' ? await callGemini(messages, context) : await callGroq(messages, context);
      record(p, out.usage);
      return { reply: out.text, provider: p, model: META[p].model, usage: snapshot() };
    } catch (e) {
      lastErr = e;
      if (isQuota(e)) markExhausted(p, e.message);
      else usage[p].lastError = e.message;
    }
  }
  throw lastErr || new Error('all_providers_failed');
}

/* ---------------- geocode + routing proxies ---------------- */
// Both geocoders read the same OSM data, but Photon indexes POIs far better:
// "Grand Indonesia" finds the mall, where Nominatim returns a convention centre
// 30km away and ranks a hamlet above the city of Bandung. Photon leads; Nominatim
// stays as a fallback for when it's unreachable.
const PHOTON = 'https://photon.komoot.io/api';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

const coords = (near) => {
  const p = (near || '').split(',').map(Number);
  return p.length === 2 && p.every(Number.isFinite) ? { lat: p[0], lon: p[1] } : null;
};

// A preference, not a bound — distant cities must still resolve.
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

// Two providers can return the same place, and one provider returns a POI plus its
// own sub-features — "Central Park" comes back as the mall, its musical fountain,
// its parking basement and its loading dock, spread over ~250m. Offering those as
// separate destinations is noise, not a decision: for driving directions they are
// the same arrival, on the same roads, in the same weather. Cluster by real
// distance (rounding coordinates would split pairs across a boundary) and keep the
// highest-ranked of each cluster.
const NEAR_DUPLICATE_KM = 0.4;

const dedupe = (list) =>
  list.reduce((keep, c) => {
    if (!keep.some((k) => distanceKm(k, c) < NEAR_DUPLICATE_KM)) keep.push(c);
    return keep;
  }, []);

async function viaPhoton(q, c) {
  const bias = c ? `&lat=${c.lat}&lon=${c.lon}` : '';
  const { status, data } = await fetchJSON(`${PHOTON}?q=${encodeURIComponent(q)}&limit=6&lang=en${bias}`, {
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
    `${NOMINATIM}?q=${encodeURIComponent(q)}&format=json&limit=6${viewboxOf(c)}`,
    { 'User-Agent': 'AetherAI/1.0 (Aether weather app)', Accept: 'application/json' }
  );
  if (status !== 200 || !Array.isArray(data) || !data.length) return [];
  // Most significant first, or a minor hamlet outranks the city of the same name.
  return [...data]
    .sort((a, b) => (b.importance || 0) - (a.importance || 0))
    .map((l) => {
      const label = l.display_name.split(',').slice(0, 2).join(',').trim();
      return { name: l.name || label, label, lat: parseFloat(l.lat), lon: parseFloat(l.lon) };
    });
}

// Returns a ranked candidate list so the client can ask the user which one they
// meant rather than betting on the top hit.
async function handleGeocode(q, near, res) {
  if (!q) return json(res, 400, { error: 'missing_q' });
  const c = coords(near);
  for (const lookup of [viaPhoton, viaNominatim]) {
    try {
      const list = dedupe(await lookup(q, c)).slice(0, 4);
      if (list.length) return json(res, 200, { candidates: list });
    } catch {
      /* try the next provider */
    }
  }
  return json(res, 404, { error: 'not_found' });
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

// A maps.app.goo.gl link carries no coordinates — only following it reveals them,
// and the browser can't read a cross-origin redirect. Only Google's own map hosts
// are followed, so this can't be used to probe arbitrary URLs.
const MAPS_HOST = /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)/i;

async function handleResolve(url, res) {
  if (!url) return json(res, 400, { error: 'missing_url' });
  if (!MAPS_HOST.test(url)) return json(res, 400, { error: 'not_a_maps_link' });

  const direct = coordsIn(url);
  if (direct) return json(res, 200, direct);

  try {
    const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (AetherAI)' } });
    const hit = coordsIn(r.url) || coordsIn(await r.text());
    if (hit) return json(res, 200, hit);
  } catch {
    /* fall through */
  }
  return json(res, 404, { error: 'not_found' });
}

async function handleRoute(from, to, res) {
  const f = (from || '').split(',');
  const t = (to || '').split(',');
  if (f.length !== 2 || t.length !== 2) return json(res, 400, { error: 'bad_coords' });
  // `annotations=duration` carries OSRM's per-node timings, which the client needs
  // to work out when the driver reaches each stretch. Without it ETAs fall back to
  // a constant-speed guess.
  const url = `https://router.project-osrm.org/route/v1/driving/${f[1]},${f[0]};${t[1]},${t[0]}?alternatives=true&overview=full&geometries=geojson&annotations=duration`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { status, data } = await fetchJSON(url);
      if (status === 200 && data && data.code === 'Ok') return json(res, 200, data);
      // OSRM reports NoRoute/InvalidQuery as 4xx with a JSON `code`. That is a
      // definitive answer, not an outage — forward it instead of burning retries
      // and collapsing it into a misleading "unavailable".
      if (data && data.code) return json(res, 200, data);
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  return json(res, 502, { error: 'routing_unavailable' });
}

/* ---------------- server ---------------- */
const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return json(res, 204, {});

  let pathname = req.url;
  let params = {};
  try {
    const u = new URL(req.url, 'http://localhost');
    pathname = u.pathname;
    params = Object.fromEntries(u.searchParams);
  } catch {
    /* keep raw */
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    return json(res, 200, {
      ok: true,
      ai: hasKey('gemini') || hasKey('groq'),
      providers: { gemini: hasKey('gemini'), groq: hasKey('groq') },
      primary: PRIMARY,
    });
  }
  if (req.method === 'GET' && pathname === '/api/usage') {
    return json(res, 200, snapshot());
  }
  if (req.method === 'GET' && pathname === '/api/geocode') {
    return handleGeocode(params.q, params.near, res);
  }
  if (req.method === 'GET' && pathname === '/api/resolve') {
    return handleResolve(params.url, res);
  }
  if (req.method === 'GET' && pathname === '/api/route') {
    return handleRoute(params.from, params.to, res);
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      try {
        const { messages = [], context = null } = JSON.parse(body || '{}');
        if (!hasKey('gemini') && !hasKey('groq')) return json(res, 200, { error: 'no_key' });
        const out = await generate(messages, context);
        json(res, 200, out);
      } catch (e) {
        json(res, 200, { error: e.code === 'no_key' ? 'no_key' : e.message || 'ai_error' });
      }
    });
    return;
  }

  json(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => {
  const provs = ORDER.filter(hasKey).map((p) => `${META[p].label}(${META[p].model})`).join(' → ') || 'NONE';
  console.log(`AetherAI backend → http://localhost:${PORT}  providers: ${provs}`);
});
