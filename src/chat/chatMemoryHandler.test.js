// Backend durable chat memory (api/_lib/core.js's chatMemory* handlers →
// Supabase's chat_messages table, supabase/migrations/0002_chat_messages.sql).
// It lives under src/ because CRA's jest is pinned to roots: ['<rootDir>/src']
// and will not discover a test file inside api/.
//
// Same setup shape as logHandler.test.js: SUPABASE_URL/SUPABASE_SERVICE_KEY are
// read once at module load, so each test that needs a specific config loads a
// fresh copy of core.js with jest.resetModules(). AbortSignal.timeout is
// polyfilled for the same reason (jsdom doesn't implement it; Node — the real
// runtime — does).
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

describe('chatMemoryWriteHandler — durable per-turn write, same degrade contract as logHandler', () => {
  test('no env configured → no-op, no fetch attempted, 204', async () => {
    const core = loadCore({ url: '', key: '' });
    const fetchSpy = (global.fetch = jest.fn());
    await expect(
      core.chatMemoryWriteHandler({ client_id: 'abc', role: 'user', text: 'hi' })
    ).resolves.toEqual({ status: 204, body: {} });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('a Supabase error (e.g. table not created yet) is swallowed, still 204', async () => {
    const core = loadCore({ url: 'https://x.supabase.co', key: 'svc-key' });
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 404, text: async () => '{"code":"PGRST205"}' });
    global.fetch = fetchMock;
    await expect(
      core.chatMemoryWriteHandler({ client_id: 'abc', role: 'user', text: 'hi' })
    ).resolves.toEqual({ status: 204, body: {} });
    expect(fetchMock).toHaveBeenCalledTimes(1); // the write was actually attempted, not skipped
  });

  test('a network error is swallowed, still 204', async () => {
    const core = loadCore({ url: 'https://x.supabase.co', key: 'svc-key' });
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    await expect(
      core.chatMemoryWriteHandler({ client_id: 'abc', role: 'user', text: 'hi' })
    ).resolves.toEqual({ status: 204, body: {} });
  });

  test('posts the expected row shape and auth headers to PostgREST', async () => {
    const core = loadCore({ url: 'https://x.supabase.co', key: 'svc-key' });
    const fetchSpy = (global.fetch = jest.fn()).mockResolvedValue({ ok: true, status: 201, text: async () => '' });
    await core.chatMemoryWriteHandler({ client_id: 'client-1', role: 'assistant', text: 'Here is the weather.' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://x.supabase.co/rest/v1/chat_messages');
    expect(opts.method).toBe('POST');
    expect(opts.headers.apikey).toBe('svc-key');
    expect(opts.headers.Authorization).toBe('Bearer svc-key');
    // Only role/text/client_id — no card/route/choice payload ever reaches the row.
    expect(JSON.parse(opts.body)).toEqual({
      client_id: 'client-1',
      role: 'assistant',
      text: 'Here is the weather.',
    });
  });

  test('text is capped to 2000 chars before it is sent', async () => {
    const core = loadCore({ url: 'https://x.supabase.co', key: 'svc-key' });
    const fetchSpy = (global.fetch = jest.fn()).mockResolvedValue({ ok: true, status: 201, text: async () => '' });
    await core.chatMemoryWriteHandler({ client_id: 'client-1', role: 'user', text: 'x'.repeat(3000) });
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sentBody.text).toHaveLength(2000);
  });

  test('missing client_id, role or text is a no-op — never a malformed row', async () => {
    const core = loadCore({ url: 'https://x.supabase.co', key: 'svc-key' });
    const fetchSpy = (global.fetch = jest.fn());
    await core.chatMemoryWriteHandler({ role: 'user', text: 'hi' });
    await core.chatMemoryWriteHandler({ client_id: 'abc', text: 'hi' });
    await core.chatMemoryWriteHandler({ client_id: 'abc', role: 'user', text: '' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('chatMemoryReadHandler — recent transcript, oldest-first', () => {
  test('no env configured → no-op, empty messages, no fetch attempted', async () => {
    const core = loadCore({ url: '', key: '' });
    const fetchSpy = (global.fetch = jest.fn());
    await expect(core.chatMemoryReadHandler('client-1')).resolves.toEqual({ status: 200, body: { messages: [] } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('missing table / Supabase error degrades to empty messages, not a throw', async () => {
    const core = loadCore({ url: 'https://x.supabase.co', key: 'svc-key' });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, text: async () => '{"code":"PGRST205"}' });
    await expect(core.chatMemoryReadHandler('client-1')).resolves.toEqual({ status: 200, body: { messages: [] } });
  });

  test('a network error degrades to empty messages', async () => {
    const core = loadCore({ url: 'https://x.supabase.co', key: 'svc-key' });
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    await expect(core.chatMemoryReadHandler('client-1')).resolves.toEqual({ status: 200, body: { messages: [] } });
  });

  test('caps the request at 50 rows, filters by client_id, and flips PostgREST\'s newest-first rows to oldest-first', async () => {
    const core = loadCore({ url: 'https://x.supabase.co', key: 'svc-key' });
    // PostgREST is asked for order=ts.desc so LIMIT keeps the most RECENT
    // rows — the handler must reverse that before returning it.
    const newestFirst = [
      { role: 'assistant', text: 'third' },
      { role: 'user', text: 'second' },
      { role: 'assistant', text: 'first reply' },
    ];
    const fetchMock = (global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => newestFirst }));
    const result = await core.chatMemoryReadHandler('client-1');
    expect(result).toEqual({
      status: 200,
      body: {
        messages: [
          { role: 'assistant', text: 'first reply' },
          { role: 'user', text: 'second' },
          { role: 'assistant', text: 'third' },
        ],
      },
    });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain('client_id=eq.client-1');
    expect(url).toContain('order=ts.desc');
    expect(url).toContain('limit=50');
  });
});

describe('chatMemoryDeleteHandler — the server side of the Trash button', () => {
  test('no env configured → no-op, no fetch attempted, 204', async () => {
    const core = loadCore({ url: '', key: '' });
    const fetchSpy = (global.fetch = jest.fn());
    await expect(core.chatMemoryDeleteHandler('client-1')).resolves.toEqual({ status: 204, body: {} });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('a Supabase error is swallowed, still 204', async () => {
    const core = loadCore({ url: 'https://x.supabase.co', key: 'svc-key' });
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, text: async () => '' });
    await expect(core.chatMemoryDeleteHandler('client-1')).resolves.toEqual({ status: 204, body: {} });
  });

  test('targets only the given client_id, and only that client', async () => {
    const core = loadCore({ url: 'https://x.supabase.co', key: 'svc-key' });
    const fetchSpy = (global.fetch = jest.fn()).mockResolvedValue({ ok: true, status: 204, text: async () => '' });
    await core.chatMemoryDeleteHandler('client-1');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://x.supabase.co/rest/v1/chat_messages?client_id=eq.client-1');
    expect(opts.method).toBe('DELETE');
    expect(opts.headers.apikey).toBe('svc-key');
    expect(opts.headers.Authorization).toBe('Bearer svc-key');
  });

  test('a missing client_id is a no-op — never an unfiltered delete', async () => {
    const core = loadCore({ url: 'https://x.supabase.co', key: 'svc-key' });
    const fetchSpy = (global.fetch = jest.fn());
    await core.chatMemoryDeleteHandler(undefined);
    await core.chatMemoryDeleteHandler('');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
