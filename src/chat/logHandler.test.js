// Backend chat-turn logging (api/_lib/core.js's logHandler → Supabase). It
// lives under src/ because CRA's jest is pinned to roots: ['<rootDir>/src']
// and will not discover a test file inside api/.
//
// SUPABASE_URL/SUPABASE_SERVICE_KEY are read once at module load, so each
// test that needs a specific config loads a fresh copy of core.js with
// jest.resetModules() — same shape as chatHandler.test.js pre-seeding
// GEMINI_API_KEY before require(). dotenv does not override an env var that
// is already set, so setting these (even to '') before require wins over
// whatever .env.local holds.
// jsdom (CRA's jest test environment) doesn't implement AbortSignal.timeout,
// which logHandler uses to bound the Supabase write — Node itself (the real
// runtime for api/_lib/core.js, dev server or Vercel function) has it, so this
// is only needed to make the code path exercisable under jest.
if (typeof AbortSignal.timeout !== 'function') {
  AbortSignal.timeout = (ms) => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), ms);
    return ctrl.signal;
  };
}

const CORE_PATH = require.resolve('../../api/_lib/core');

const loadCore = ({ url = '', key = '' } = {}) => {
  jest.resetModules();
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_KEY = key;
  return require(CORE_PATH);
};

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

describe('logHandler never breaks chat — fire-and-forget telemetry', () => {
  test('no env configured → no-op, no fetch attempted, 204', async () => {
    const core = loadCore({ url: '', key: '' });
    const fetchSpy = (global.fetch = jest.fn());
    await expect(core.logHandler({ message: 'hi' })).resolves.toEqual({ status: 204, body: {} });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('a Supabase error (e.g. table not created yet) is swallowed, still 204', async () => {
    const core = loadCore({ url: 'https://x.supabase.co', key: 'svc-key' });
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 404, text: async () => '{"code":"PGRST205"}' });
    global.fetch = fetchMock;
    await expect(core.logHandler({ message: 'hi' })).resolves.toEqual({ status: 204, body: {} });
    expect(fetchMock).toHaveBeenCalledTimes(1); // the write was actually attempted, not skipped
  });

  test('a network error is swallowed, still 204', async () => {
    const core = loadCore({ url: 'https://x.supabase.co', key: 'svc-key' });
    const fetchMock = jest.fn().mockRejectedValue(new Error('network down'));
    global.fetch = fetchMock;
    await expect(core.logHandler({ message: 'hi' })).resolves.toEqual({ status: 204, body: {} });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('coordinates are stripped from parsed before the row is sent, nested included', async () => {
    const core = loadCore({ url: 'https://x.supabase.co', key: 'svc-key' });
    const fetchSpy = (global.fetch = jest.fn()).mockResolvedValue({ ok: true, status: 201, text: async () => '' });
    await core.logHandler({
      message: 'route to grand indonesia',
      handler: 'route',
      outcome: 'ok',
      parsed: { origin: { name: 'Jakarta', lat: -6.2, lon: 106.8 }, destination: 'Grand Indonesia' },
    });
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sentBody.parsed).toEqual({ origin: { name: 'Jakarta' }, destination: 'Grand Indonesia' });
  });

  test('message is capped to 2000 chars before it is sent', async () => {
    const core = loadCore({ url: 'https://x.supabase.co', key: 'svc-key' });
    const fetchSpy = (global.fetch = jest.fn()).mockResolvedValue({ ok: true, status: 201, text: async () => '' });
    await core.logHandler({ message: 'x'.repeat(3000) });
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sentBody.message).toHaveLength(2000);
  });

  test('posts the expected row shape and auth headers to PostgREST', async () => {
    const core = loadCore({ url: 'https://x.supabase.co', key: 'svc-key' });
    const fetchSpy = (global.fetch = jest.fn()).mockResolvedValue({ ok: true, status: 201, text: async () => '' });
    await core.logHandler({
      session_id: 'sess-1',
      message: 'weather in surabaya',
      handler: 'fallback',
      outcome: 'geocode_failed',
      parsed: { place: 'Surabaya' },
      city: 'Surabaya',
      provider: 'gemini',
      latency_ms: 42,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://x.supabase.co/rest/v1/chat_log');
    expect(opts.method).toBe('POST');
    expect(opts.headers.apikey).toBe('svc-key');
    expect(opts.headers.Authorization).toBe('Bearer svc-key');
    expect(JSON.parse(opts.body)).toEqual({
      session_id: 'sess-1',
      message: 'weather in surabaya',
      handler: 'fallback',
      parsed: { place: 'Surabaya' },
      outcome: 'geocode_failed',
      city: 'Surabaya',
      provider: 'gemini',
      latency_ms: 42,
    });
  });
});
