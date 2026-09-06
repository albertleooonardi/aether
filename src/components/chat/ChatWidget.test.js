// Chat persistence: a page refresh used to lose the whole conversation
// because `messages` was a plain useState with a hardcoded intro. These
// exercise the pure save/load/strip helpers directly — there's no jsdom
// render test for this widget, and adding one is out of scope here.
import { stripExtras, loadChat, saveChat, clearChat, reconcileChat } from './ChatWidget';

const CHAT_STORAGE_KEY = 'vrijeme.chat.v1';

beforeEach(() => {
  window.localStorage.clear();
});

describe('stripExtras', () => {
  test('drops the weather/route/choice payload but keeps the text', () => {
    const msgs = [
      { id: '1', role: 'user', text: 'Weather in Surabaya' },
      {
        id: '2',
        role: 'assistant',
        text: "Here's Surabaya right now.",
        kind: 'weather',
        data: { name: 'Surabaya', temp: 31 },
      },
      {
        id: '3',
        role: 'assistant',
        text: 'I found a few places — which one did you mean?',
        kind: 'choice',
        data: { candidates: [{ name: 'A' }], chosen: null },
      },
      {
        id: '4',
        role: 'assistant',
        text: "Here's the route.",
        kind: 'route',
        data: { origin: {}, dest: {}, routes: [] },
      },
    ];
    const stripped = stripExtras(msgs);
    expect(stripped).toEqual([
      { id: '1', role: 'user', text: 'Weather in Surabaya' },
      { id: '2', role: 'assistant', text: "Here's Surabaya right now." },
      { id: '3', role: 'assistant', text: 'I found a few places — which one did you mean?' },
      { id: '4', role: 'assistant', text: "Here's the route." },
    ]);
    stripped.forEach((m) => {
      expect(m.kind).toBeUndefined();
      expect(m.data).toBeUndefined();
    });
  });
});

describe('saveChat', () => {
  test('strips extras before writing to storage, not just on the way back in', () => {
    saveChat([
      {
        id: '1',
        role: 'assistant',
        text: "Here's Surabaya right now.",
        kind: 'weather',
        data: { name: 'Surabaya', temp: 31 },
      },
    ]);
    const raw = JSON.parse(window.localStorage.getItem(CHAT_STORAGE_KEY));
    expect(raw).toEqual([{ id: '1', role: 'assistant', text: "Here's Surabaya right now." }]);
  });

  test('caps the stored transcript at the last 50 messages', () => {
    const msgs = Array.from({ length: 60 }, (_, i) => ({
      id: `${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: `message ${i}`,
    }));
    saveChat(msgs);
    const raw = JSON.parse(window.localStorage.getItem(CHAT_STORAGE_KEY));
    expect(raw).toHaveLength(50);
    // The oldest 10 were dropped — only the tail survives.
    expect(raw[0].text).toBe('message 10');
    expect(raw[raw.length - 1].text).toBe('message 59');
  });
});

describe('loadChat', () => {
  test('returns null when there is no stored transcript, so the intro is shown', () => {
    expect(loadChat()).toBeNull();
  });

  test('restores text and role, stripping any extras that made it into storage', () => {
    window.localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify([
        { id: '1', role: 'user', text: 'Route to Grand Indonesia' },
        {
          id: '2',
          role: 'assistant',
          text: "Here's the route.",
          kind: 'route',
          data: { origin: {}, dest: {}, routes: [] },
        },
      ])
    );
    const restored = loadChat();
    expect(restored).toEqual([
      { id: '1', role: 'user', text: 'Route to Grand Indonesia' },
      { id: '2', role: 'assistant', text: "Here's the route." },
    ]);
  });

  test('a corrupt/unparseable stored value degrades to null rather than throwing', () => {
    window.localStorage.setItem(CHAT_STORAGE_KEY, '{not json');
    expect(() => loadChat()).not.toThrow();
    expect(loadChat()).toBeNull();
  });

  test('a non-array stored value also degrades to null rather than being restored', () => {
    window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ oops: true }));
    expect(loadChat()).toBeNull();
  });
});

describe('reconcileChat', () => {
  test('an untouched intro placeholder does not block hydrating a real server transcript', () => {
    const current = [{ id: 'intro', role: 'assistant', text: 'Hi' }];
    const server = [
      { role: 'user', text: 'Weather in Surabaya' },
      { role: 'assistant', text: "Here's Surabaya right now." },
    ];
    const result = reconcileChat(current, server);
    expect(result.map(({ role, text }) => ({ role, text }))).toEqual(server);
  });

  test('a longer local transcript is kept — a fresh tab must not wipe real history', () => {
    const current = [
      { id: '1', role: 'user', text: 'a' },
      { id: '2', role: 'assistant', text: 'b' },
      { id: '3', role: 'user', text: 'c' },
    ];
    const server = [{ role: 'user', text: 'a' }];
    expect(reconcileChat(current, server)).toBe(current);
  });

  test('a longer server transcript replaces a shorter local one', () => {
    const current = [{ id: '1', role: 'user', text: 'a' }];
    const server = [
      { role: 'user', text: 'a' },
      { role: 'assistant', text: 'b' },
      { role: 'user', text: 'c' },
    ];
    const result = reconcileChat(current, server);
    expect(result.map(({ role, text }) => ({ role, text }))).toEqual(server);
  });

  test('an empty or missing server transcript never overwrites local (no server-side data loss inferred from silence)', () => {
    const current = [{ id: '1', role: 'user', text: 'a' }];
    expect(reconcileChat(current, [])).toBe(current);
    expect(reconcileChat(current, null)).toBe(current);
    expect(reconcileChat(current, undefined)).toBe(current);
  });

  test('equal length keeps local rather than churning ids for no gain', () => {
    const current = [{ id: '1', role: 'user', text: 'a' }];
    const server = [{ role: 'user', text: 'a' }];
    expect(reconcileChat(current, server)).toBe(current);
  });
});

describe('clearChat', () => {
  test('wipes the stored transcript', () => {
    saveChat([{ id: '1', role: 'user', text: 'hi' }]);
    expect(window.localStorage.getItem(CHAT_STORAGE_KEY)).not.toBeNull();
    clearChat();
    expect(window.localStorage.getItem(CHAT_STORAGE_KEY)).toBeNull();
  });
});
