import {
  norm,
  matchRank,
  highlightParts,
  samePlace,
  formatDistance,
  buildLocalGroups,
  mergeRemote,
  flatItems,
} from './Suggestions';
import { CITIES } from '../data/cities';
import { loadRecents, addRecent, removeRecent } from '../services/RecentPlaces';
import { wmoText } from '../services/CityWeather';

const jakarta = { name: 'Jakarta', label: 'Jakarta, Indonesia', lat: -6.2088, lon: 106.8456 };
const bandung = { name: 'Bandung', label: 'Bandung, Indonesia', lat: -6.9175, lon: 107.6191 };

describe('matching', () => {
  test('norm strips accents and case', () => {
    expect(norm('São Paulo')).toBe('sao paulo');
  });

  test('matchRank prefers name prefix, then word prefix, then label', () => {
    expect(matchRank({ name: 'Bandung' }, 'ban')).toBe(3);
    expect(matchRank({ name: 'Bandar Lampung' }, 'lam')).toBe(2);
    expect(matchRank({ name: 'Ubud', label: 'Ubud, Bali, Indonesia' }, 'bali')).toBe(1);
    expect(matchRank({ name: 'Ubud' }, 'xyz')).toBe(0);
    expect(matchRank({ name: 'Ubud' }, '   ')).toBe(0);
  });

  test('highlightParts marks the matched slice, accent-insensitively', () => {
    expect(highlightParts('São Paulo', 'sao')).toEqual([
      { text: 'São', match: true },
      { text: ' Paulo', match: false },
    ]);
    expect(highlightParts('Jakarta', 'zzz')).toEqual([{ text: 'Jakarta', match: false }]);
  });

  test('samePlace: close together, or same name within a metro area', () => {
    expect(samePlace(jakarta, { ...jakarta, lat: jakarta.lat + 0.001 })).toBe(true);
    expect(samePlace(jakarta, { ...jakarta, lat: jakarta.lat + 0.1 })).toBe(true);
    expect(samePlace(jakarta, bandung)).toBe(false);
    expect(samePlace(jakarta, null)).toBe(false);
  });

  test('formatDistance', () => {
    expect(formatDistance(0.42)).toBe('420 m');
    expect(formatDistance(3.456)).toBe('3.5 km');
    expect(formatDistance(1234.4)).toBe('1,234 km');
  });
});

describe('buildLocalGroups', () => {
  test('empty query: locate, recent, then nearby cities sorted by distance', () => {
    const groups = buildLocalGroups({ query: '', recents: [bandung], cities: CITIES, near: jakarta, locate: true });
    expect(groups.map((g) => g.id)).toEqual(['locate', 'recent', 'nearby']);
    expect(groups[1].items[0].title).toBe('Bandung');
    expect(groups[1].items[0].removable).toBe(true);
    const nearby = groups[2].items.map((i) => i.title);
    expect(nearby[0]).toBe('Jakarta');
    // A recent place is not repeated as a nearby suggestion.
    expect(nearby).not.toContain('Bandung');
    expect(groups[2].items[0].meta).toMatch(/m$/);
  });

  test('empty query without a bias point falls back to Popular', () => {
    const groups = buildLocalGroups({ cities: CITIES });
    expect(groups.map((g) => g.id)).toEqual(['popular']);
    expect(groups[0].items).toHaveLength(5);
  });

  test('typed query returns ranked matches, recents first on ties', () => {
    const recent = { name: 'Bandung Electronic Center', label: 'BEC, Bandung', lat: -6.9, lon: 107.6 };
    const groups = buildLocalGroups({ query: 'band', recents: [recent], cities: CITIES });
    const titles = flatItems(groups).map((i) => i.title);
    expect(titles[0]).toBe('Bandung Electronic Center');
    expect(titles).toContain('Bandar Lampung');
    expect(groups[0].id).toBe('matches');
  });

  test('typed query with no match returns no groups', () => {
    expect(buildLocalGroups({ query: 'qqqq', cities: CITIES })).toEqual([]);
  });
});

describe('mergeRemote', () => {
  test('appends remote results minus anything already shown', () => {
    const local = buildLocalGroups({ query: 'jak', cities: CITIES });
    const merged = mergeRemote(local, [
      { ...jakarta, lat: jakarta.lat + 0.0005 }, // duplicate of the local Jakarta
      { name: 'Jakarta Selatan', label: 'Jakarta Selatan, Indonesia', lat: -6.2615, lon: 106.8106 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[1].items.map((i) => i.title)).toEqual(['Jakarta Selatan']);
  });

  test('no new remote items leaves the groups untouched', () => {
    const local = buildLocalGroups({ query: 'jak', cities: CITIES });
    expect(mergeRemote(local, [])).toBe(local);
  });

  test('item keys are unique across groups', () => {
    const groups = buildLocalGroups({ query: '', recents: [jakarta], cities: CITIES, near: jakarta, locate: true });
    const keys = flatItems(groups).map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('RecentPlaces', () => {
  beforeEach(() => localStorage.clear());

  test('adds newest first, dedupes, caps at 8, skips placeholders', () => {
    addRecent(jakarta);
    addRecent(bandung);
    addRecent({ ...jakarta, lat: jakarta.lat + 0.0001 });
    expect(loadRecents().map((p) => p.name)).toEqual(['Jakarta', 'Bandung']);

    addRecent({ name: 'My location', lat: 1, lon: 1 });
    expect(loadRecents()).toHaveLength(2);

    for (let i = 0; i < 10; i++) addRecent({ name: `P${i}`, lat: i, lon: i });
    expect(loadRecents()).toHaveLength(8);
  });

  test('remove and corrupt storage', () => {
    addRecent(jakarta);
    expect(removeRecent(jakarta)).toEqual([]);
    localStorage.setItem('aether.recentPlaces.v1', '{not json');
    expect(loadRecents()).toEqual([]);
  });
});

describe('cities data', () => {
  test('every city has valid coordinates and a unique name', () => {
    CITIES.forEach((c) => {
      expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(c.lon)).toBeLessThanOrEqual(180);
      expect([1, 2]).toContain(c.tier);
    });
    expect(new Set(CITIES.map((c) => c.name)).size).toBe(CITIES.length);
  });

  test('WMO codes map to words the icon picker understands', () => {
    expect(wmoText(0)).toBe('Clear');
    expect(wmoText(2)).toBe('Partly cloudy');
    expect(wmoText(63)).toBe('Rain');
    expect(wmoText(95)).toBe('Thunderstorm');
    expect(wmoText(73)).toBe('Snow');
  });
});
