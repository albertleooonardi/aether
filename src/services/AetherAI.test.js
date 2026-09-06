import { checkStatus, getClientId, saveMessage, fetchMemory, deleteMemory } from './AetherAI';

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

// t.clear() sat after the await, so it was skipped whenever fetch threw and the
// 4s abort timer stayed armed — the node process lingered 4s past every failed
// probe. askAI already used try/finally; checkStatus did not.
describe('checkStatus clears its abort timer on every path', () => {
  test.each([
    ['fetch rejects', () => Promise.reject(new Error('network down'))],
    ['fetch returns a non-ok response', () => Promise.resolve({ ok: false })],
    ['the body is unparseable', () => Promise.resolve({ ok: true, json: async () => { throw new Error('not json'); } })],
    ['the probe succeeds', () => Promise.resolve({ ok: true, json: async () => ({ ai: true }) })],
  ])('%s', async (_, impl) => {
    jest.useFakeTimers();
    global.fetch = jest.fn(impl);
    await checkStatus();
    expect(jest.getTimerCount()).toBe(0);
  });

  test('a failed probe still reports offline', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    expect(await checkStatus()).toEqual({ status: 'offline', providers: null, primary: null });
  });
});

// Durable chat memory: a stable per-browser client_id (not the ephemeral,
// per-tab SESSION_ID used for chat_log telemetry) keys the Supabase-backed
// transcript so it survives a closed tab / new session.
describe('getClientId', () => {
  test('generates an id once and persists it across calls', () => {
    const first = getClientId();
    expect(first).toEqual(expect.any(String));
    expect(first.length).toBeGreaterThan(0);
    expect(getClientId()).toBe(first);
    expect(window.localStorage.getItem('vrijeme.client.v1')).toBe(first);
  });
});

describe('saveMessage', () => {
  test('posts client_id, role and text to /api/chat-memory', () => {
    const fetchSpy = (global.fetch = jest.fn().mockResolvedValue({ ok: true }));
    saveMessage('user', 'Weather in Surabaya');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/chat-memory');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.role).toBe('user');
    expect(body.text).toBe('Weather in Surabaya');
    expect(body.client_id).toBe(getClientId());
  });

  test('caps text to 2000 chars before sending', () => {
    const fetchSpy = (global.fetch = jest.fn().mockResolvedValue({ ok: true }));
    saveMessage('assistant', 'x'.repeat(3000));
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.text).toHaveLength(2000);
  });

  test('blank text is a no-op — nothing worth persisting, no fetch attempted', () => {
    const fetchSpy = (global.fetch = jest.fn());
    saveMessage('user', '');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('a fetch rejection never throws — a storage outage must not surface to the caller', () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    expect(() => saveMessage('user', 'hi')).not.toThrow();
  });
});

describe('fetchMemory', () => {
  test('returns the transcript on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }] }),
    });
    expect(await fetchMemory()).toEqual([
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'hello' },
    ]);
  });

  test('requests this client_id specifically', async () => {
    const fetchSpy = (global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [] }) }));
    await fetchMemory();
    expect(fetchSpy.mock.calls[0][0]).toBe(`/api/chat-memory?client_id=${encodeURIComponent(getClientId())}`);
  });

  test('degrades to [] on a non-ok response, unparseable body, or network error', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    expect(await fetchMemory()).toEqual([]);

    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('bad json'); } });
    expect(await fetchMemory()).toEqual([]);

    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    expect(await fetchMemory()).toEqual([]);
  });
});

describe('deleteMemory', () => {
  test('DELETEs /api/chat-memory scoped to this client_id', () => {
    const fetchSpy = (global.fetch = jest.fn().mockResolvedValue({ ok: true }));
    deleteMemory();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/chat-memory?client_id=${encodeURIComponent(getClientId())}`);
    expect(opts.method).toBe('DELETE');
  });

  test('a fetch rejection never throws', () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    expect(() => deleteMemory()).not.toThrow();
  });
});
