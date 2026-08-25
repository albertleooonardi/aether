import { checkStatus } from './AetherAI';

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
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
