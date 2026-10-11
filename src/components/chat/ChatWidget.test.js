// Chat persistence: a page refresh used to lose the whole conversation
// because `messages` was a plain useState with a hardcoded intro. These
// exercise the pure save/load/strip helpers directly — there's no jsdom
// render test for this widget, and adding one is out of scope here.
import { displayedContext, stripExtras, loadChat, saveChat, clearChat } from './ChatWidget';

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

describe('clearChat', () => {
  test('wipes the stored transcript', () => {
    saveChat([{ id: '1', role: 'user', text: 'hi' }]);
    expect(window.localStorage.getItem(CHAT_STORAGE_KEY)).not.toBeNull();
    clearChat();
    expect(window.localStorage.getItem(CHAT_STORAGE_KEY)).toBeNull();
  });
});

describe('displayedContext', () => {
  const now = new Date('2026-07-16T10:00:00').getTime();
  const rt = (km, min, level) => ({
    distanceKm: km,
    durationMin: min,
    rain: { level, segments: [{ from: [1, 2], to: [3, 4], level }] },
    coords: [[1, 2], [3, 4]],
  });
  const card = {
    origin: { name: 'Home', lat: 1, lon: 2 },
    dest: { name: 'Mall', lat: 3, lon: 4 },
    routes: [rt(32.14, 30.2, 'dry'), rt(36.4, 37.6, 'light')],
    bestIndex: 0,
    shownAt: now,
  };

  it('shapes a route card compactly with the labels the card renders', () => {
    const d = displayedContext(card, [], now);
    expect(d.route.origin).toBe('Home');
    expect(d.route.destination).toBe('Mall');
    expect(d.route.options).toEqual([
      { label: 'Recommended', distance_km: 32.1, duration_min: 30, rain: 'dry' },
      { label: 'Option 2', distance_km: 36.4, duration_min: 38, rain: 'light' },
    ]);
    expect(d.reminders).toBeUndefined();
  });

  it('excludes coordinates and geometry', () => {
    const json = JSON.stringify(displayedContext(card, [], now));
    expect(json).not.toMatch(/lat|lon|coords|segments|from|"to"/);
  });

  it('keeps only active reminders', () => {
    const d = displayedContext(null, [
      { label: 'old', dueEpoch: now - 1000 },
      { label: 'umbrella', dueEpoch: now + 3600000 },
    ], now);
    expect(d.reminders).toEqual([{ label: 'umbrella', due: expect.any(String) }]);
    expect(d.route).toBeUndefined();
  });

  it('returns null when nothing is shown', () => {
    expect(displayedContext(null, [{ label: 'old', dueEpoch: now - 1 }], now)).toBeNull();
  });
});
