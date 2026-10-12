// Backend chat contract (api/_lib/core.js). It lives under src/ because CRA's
// jest is pinned to roots: ['<rootDir>/src'] and will not discover a test file
// inside api/.
//
// A key has to exist before core.js is required, or chatHandler short-circuits
// on the no_key guard and never reaches what these tests are about. dotenv does
// not override an env var that is already set, so this wins over .env.local.
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key-for-jest';
const { trimmed, chatHandler } = require('../../api/_lib/core');

// trimmed() filtered on m.text, so an OpenAI-shaped { role, content } message was
// dropped: the request answered 200 while Gemini got an empty conversation,
// 400'd ("contents is not specified"), and Groq answered a prompt with no user
// text in it at all.
describe('trimmed accepts either message shape', () => {
  test('an OpenAI-style { role, content } message survives, normalised onto text', () => {
    expect(trimmed([{ role: 'user', content: 'hi' }])).toMatchObject([{ role: 'user', text: 'hi' }]);
  });

  test("the app's own { role, text } shape is unchanged", () => {
    expect(trimmed([{ role: 'user', text: 'hi' }])).toMatchObject([{ role: 'user', text: 'hi' }]);
  });

  test('empty, blank and null entries are still dropped', () => {
    expect(trimmed([null, { role: 'user' }, { role: 'user', content: '' }, { role: 'user', text: '' }])).toEqual([]);
  });

  test('a missing or non-array payload is empty, not a throw', () => {
    expect(trimmed(undefined)).toEqual([]);
    expect(trimmed('hi')).toEqual([]);
  });
});

describe('chatHandler rejects a payload with nothing to answer', () => {
  test.each([
    ['an empty list', []],
    ['a blank message', [{ role: 'user', content: '' }]],
    ['no messages key at all', undefined],
  ])('%s → 400 no_messages, with no provider call', async (_, messages) => {
    expect(await chatHandler({ messages, context: {} })).toEqual({
      status: 400,
      body: { error: 'no_messages' },
    });
  });
});

// get_route → actions: the endpoints the model resolved are surfaced to the
// client (which draws the map card) without ever entering the tool result the
// model reads. Groq is used because its HTTP goes through global fetch, so the
// whole turn (provider, geocoder, OSRM) can be mocked; core.js is loaded fresh
// per test so usage/cooldown state can't leak between them.
describe('chatHandler surfaces get_route endpoints as actions', () => {
  // jsdom lacks AbortSignal.timeout, which fetchJSON uses; without it every
  // geocode throws and is swallowed, so the route tool never gets past "not found".
  if (typeof AbortSignal.timeout !== 'function') {
    AbortSignal.timeout = (ms) => {
      const ctrl = new AbortController();
      setTimeout(() => ctrl.abort(), ms);
      return ctrl.signal;
    };
  }
  const PLACES = {
    'aeon mall bsd': { name: 'AEON Mall BSD', lat: -6.3, lon: 106.64 },
    'grand indonesia': { name: 'Grand Indonesia', lat: -6.195, lon: 106.82 },
    'plaza senayan': { name: 'Plaza Senayan', lat: -6.225, lon: 106.8 },
  };
  const json = (status, data) => ({ status, text: async () => JSON.stringify(data), json: async () => data });
  const toolCall = (id, origin, destination) => ({
    id,
    function: { name: 'get_route', arguments: JSON.stringify({ origin, destination }) },
  });

  // `turns` = the model's successive replies; each is a list of tool calls, or a string for the final text.
  const run = async (turns, { osrmOk = true } = {}) => {
    jest.resetModules();
    process.env.AI_PRIMARY = 'groq';
    process.env.GROQ_API_KEY = 'groq-test';
    process.env.WEATHER_API_KEY = '';
    const groqBodies = [];
    let step = 0;
    global.fetch = jest.fn(async (url, init) => {
      url = String(url);
      if (url.includes('api.groq.com')) {
        groqBodies.push(JSON.parse(init.body));
        const t = turns[step++];
        const message = typeof t === 'string' ? { content: t } : { content: null, tool_calls: t };
        return json(200, { choices: [{ message }], usage: { total_tokens: 1 } });
      }
      if (url.includes('photon')) {
        const q = decodeURIComponent(new URL(url).searchParams.get('q')).toLowerCase();
        const p = PLACES[q];
        return json(200, {
          features: p
            ? [{ properties: { name: p.name, country: 'Indonesia' }, geometry: { coordinates: [p.lon, p.lat] } }]
            : [],
        });
      }
      if (url.includes('router.project-osrm.org')) {
        return osrmOk
          ? json(200, { code: 'Ok', routes: [{ distance: 12000, duration: 1500 }] })
          : json(200, { code: 'NoRoute', routes: [] });
      }
      return json(404, {});
    });
    const { chatHandler: handler } = require('../../api/_lib/core');
    const res = await handler({ messages: [{ role: 'user', text: 'Road me to AEON Mall BSD' }], context: null });
    return { res, groqBodies };
  };

  afterEach(() => {
    delete process.env.AI_PRIMARY;
    delete process.env.GROQ_API_KEY;
    delete process.env.WEATHER_API_KEY;
    delete global.fetch;
  });

  test('a get_route call yields an action carrying both endpoints with coordinates', async () => {
    const { res } = await run([[toolCall('a', 'Grand Indonesia', 'AEON Mall BSD')], 'Takes ~25 min.']);
    expect(res.body.reply).toBe('Takes ~25 min.');
    expect(res.body.actions).toEqual([
      {
        kind: 'route',
        origin: { name: 'Grand Indonesia', lat: -6.195, lon: 106.82 },
        dest: { name: 'AEON Mall BSD', lat: -6.3, lon: 106.64 },
      },
    ]);
  });

  test('the tool result the model sees carries no coordinates', async () => {
    const { groqBodies } = await run([[toolCall('a', 'Grand Indonesia', 'AEON Mall BSD')], 'ok']);
    const toolMsg = groqBodies[1].messages.find((m) => m.role === 'tool');
    expect(JSON.parse(toolMsg.content)).toMatchObject({ origin: expect.any(String), distance_km: 12, duration_min: 25 });
    // Same keys as before this feature; no lat/lon field anywhere. (destination_weather's own
    // error text may echo its query, which is pre-existing and not what's under test.)
    expect(Object.keys(JSON.parse(toolMsg.content))).toEqual([
      'origin',
      'destination',
      'distance_km',
      'duration_min',
      'note',
      'destination_weather',
    ]);
    expect(toolMsg.content).not.toMatch(/"(lat|lon|origin_coords|dest)"/);
  });

  test('two get_route calls in one turn dedupe to one action, keeping the last', async () => {
    const { res } = await run([
      [toolCall('a', 'Grand Indonesia', 'AEON Mall BSD')],
      [toolCall('b', 'Plaza Senayan', 'AEON Mall BSD'), toolCall('c', 'Plaza Senayan', 'AEON Mall BSD')],
      'done',
    ]);
    expect(res.body.actions).toHaveLength(1);
    expect(res.body.actions[0].origin.name).toBe('Plaza Senayan');
  });

  test('a turn with no route tool call has no actions key at all', async () => {
    const { res } = await run(['Sunny today.']);
    expect(res.body.reply).toBe('Sunny today.');
    expect('actions' in res.body).toBe(false);
  });

  test('a failed get_route (no road route) contributes no action', async () => {
    const { res } = await run([[toolCall('a', 'Grand Indonesia', 'AEON Mall BSD')], 'No route found.'], {
      osrmOk: false,
    });
    expect(res.body.reply).toBe('No route found.');
    expect('actions' in res.body).toBe(false);
  });

  test('a failed get_route after a good one does not displace it (last SUCCESSFUL wins)', async () => {
    const { res } = await run([
      [toolCall('a', 'Grand Indonesia', 'AEON Mall BSD')],
      [toolCall('b', 'Nowhere At All', 'AEON Mall BSD')],
      'done',
    ]);
    expect(res.body.actions).toHaveLength(1);
    expect(res.body.actions[0].origin.name).toBe('Grand Indonesia');
  });
});

// A provider that accepts the connection and then never answers is the most
// expensive failure there is — it costs the whole 30s timeout, where a 429 costs
// milliseconds. isQuota() matched only quota signatures, so 'provider timeout'
// never benched the provider and a hung primary was retried on EVERY message:
// measured, 6 of 15 replies took over 25s with Gemini answering none of them.
describe('a hung provider is benched, not retried forever', () => {
  const { isBenchable } = require('../../api/_lib/core');

  test('a timeout benches the provider', () => {
    expect(isBenchable(new Error('provider timeout'))).toBe(true);
  });

  test('connection-level failures bench it too', () => {
    for (const m of ['socket hang up', 'ECONNRESET', 'ECONNREFUSED', 'fetch failed', 'getaddrinfo ENOTFOUND x']) {
      expect(isBenchable(new Error(m))).toBe(true);
    }
  });

  test('quota and rate-limit signatures still bench it', () => {
    expect(isBenchable(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    expect(isBenchable(Object.assign(new Error('x'), { status: 402 }))).toBe(true);
    expect(isBenchable(new Error('You exceeded your current quota'))).toBe(true);
    expect(isBenchable(new Error('Rate limit reached for model'))).toBe(true);
  });

  test('an ordinary error does NOT bench the provider', () => {
    expect(isBenchable(new Error('contents is not specified'))).toBe(false);
    expect(isBenchable(Object.assign(new Error('bad request'), { status: 400 }))).toBe(false);
  });
});

// toolRainOverview decided "is it raining" by text-matching the condition label,
// which is the test RouteService documents as wrong. Live, it named Jakarta,
// Bandung, Semarang and Denpasar as raining — all code 1063 "Patchy rain nearby",
// which the route scorer in the same app calls dry. One app, two answers.
describe('rain overview agrees with the route scorer', () => {
  const { isRainingNow } = require('../../api/_lib/core');
  const at = (code, precip_mm, text) => ({ condition: { code, text }, precip_mm });

  test('"Patchy rain nearby" (1063) is NOT rain, however the label reads', () => {
    expect(isRainingNow(at(1063, 0.14, 'Patchy rain nearby'))).toBe(false);
    expect(isRainingNow(at(1063, 0.01, 'Patchy rain nearby'))).toBe(false);
  });

  test('falling precipitation (code >= 1150) is rain', () => {
    expect(isRainingNow(at(1183, 1.31, 'Light rain'))).toBe(true);
    expect(isRainingNow(at(1153, 0, 'Light drizzle'))).toBe(true);
    expect(isRainingNow(at(1213, 0, 'Patchy light snow'))).toBe(true);
  });

  test('a dry label with real accumulation is still rain', () => {
    expect(isRainingNow(at(1030, 0.9, 'Mist'))).toBe(true);
  });

  test('a trace amount is a rounding artifact, not weather', () => {
    expect(isRainingNow(at(1063, 0.2, 'Patchy rain nearby'))).toBe(false);
  });

  test('plainly dry conditions are dry', () => {
    expect(isRainingNow(at(1036, 0, 'Smoky haze'))).toBe(false);
    expect(isRainingNow(at(1000, 0, 'Sunny'))).toBe(false);
  });

  test('a malformed payload does not throw or claim rain', () => {
    expect(isRainingNow(undefined)).toBe(false);
    expect(isRainingNow({})).toBe(false);
  });
});
