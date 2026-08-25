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
