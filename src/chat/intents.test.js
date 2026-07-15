import { parseNavigation, parseMapsUrl, parseWeatherIn } from './intents';

describe('parseWeatherIn', () => {
  // Asking about Pontianak and being told Jembatanmerah's temperature is worse
  // than no answer: only "in/at/for" counted as pointing at a place, so "of"
  // found nothing and the reply silently fell back to the current city.
  test.each([
    ['What is the temp of Pontianak now', 'Pontianak'],
    ['what is the temperature of Pontianak', 'Pontianak'],
    ['weather in Surabaya', 'Surabaya'],
    ['will it rain in Tokyo', 'Tokyo'],
    ['how hot is it in London', 'London'],
    ['what is the weather around Bandung', 'Bandung'],
    ['forecast for Jakarta tomorrow', 'Jakarta'],
  ])('%j -> %j', (text, place) => {
    expect(parseWeatherIn(text)).toBe(place);
  });

  // "of" also appears in "chance of rain", where the next word is weather, not a
  // place — geocoding "rain" would be nonsense.
  test('"chance of rain today" names no place', () => {
    expect(parseWeatherIn('what is the chance of rain today')).toBeNull();
  });

  test('"chance of rain in Pontianak" still finds Pontianak', () => {
    expect(parseWeatherIn('what is the chance of rain in Pontianak')).toBe('Pontianak');
  });

  test('current-location questions stay with the current location', () => {
    expect(parseWeatherIn('what is the weather in my area')).toBeNull();
    expect(parseWeatherIn('is it hot here')).toBeNull();
  });

  test('non-weather messages are ignored', () => {
    expect(parseWeatherIn('remind me to call mum at 6pm')).toBeNull();
  });
});

// The app's own suggestion chip is phrased this way. The dash used to survive into
// the geocoder query, and "Grand Indonesia —" ranks a different place first.
test.each([
  'Route from my place to Grand Indonesia — will it rain?',
  'Route from my place to Grand Indonesia – will it rain?',
  'Route from my place to Grand Indonesia - will it rain?',
])('strips the trailing dash from %j', (text) => {
  expect(parseNavigation(text).destText).toBe('Grand Indonesia');
});

test('a dash inside a place name is kept', () => {
  expect(parseNavigation('route to Wilkes-Barre').destText).toBe('Wilkes-Barre');
});

describe('Google Maps links', () => {
  const url = 'https://www.google.com/maps/place/Grand+Indonesia/@-6.1958,106.8215,17z';

  test('a link is taken verbatim, not sliced at its dots', () => {
    expect(parseNavigation(`route to ${url}`)).toMatchObject({ destText: url, isUrl: true });
  });

  test('origin is still parsed alongside a link', () => {
    expect(parseNavigation(`route from Senen to ${url}`)).toMatchObject({ originText: 'Senen', destText: url });
  });

  test('short links survive intact', () => {
    const short = 'https://maps.app.goo.gl/abc123';
    expect(parseNavigation(`directions to ${short}`).destText).toBe(short);
  });

  test('parseMapsUrl finds a bare pasted link', () => {
    expect(parseMapsUrl(`  ${url}  `)).toBe(url);
    expect(parseMapsUrl('no link here')).toBeNull();
  });
});

// Filler between the nav word and the destination is ordinary English. These were
// recognised as navigation and then dropped, because extraction demanded that "to"
// follow the nav word immediately.
test.each([
  ['Can you check the route for going to Central Park', 'Central Park'],
  ['can you check the route for going to Central Park?', 'Central Park'],
  ['what is the best way of getting to Grand Indonesia', 'Grand Indonesia'],
  ['show me directions for driving to Bandung', 'Bandung'],
  ['I need the route over to Senen', 'Senen'],
])('parses filler phrasing %j', (text, dest) => {
  expect(parseNavigation(text)).toMatchObject({ destText: dest });
});

// "into"/"towards" used to miss the parser entirely — \bto\b never matches inside
// "into" — so these fell through to a generic "I can help with rain…" reply.
test.each([
  ['Can you analyze my route from my place into Maspion Plaza', null, 'Maspion Plaza'],
  ['Route from my place into Maspion Plaza', null, 'Maspion Plaza'],
  ['route from Jakarta into Bandung', 'Jakarta', 'Bandung'],
  ['directions towards Grand Indonesia', null, 'Grand Indonesia'],
  ['drive toward Surabaya', null, 'Surabaya'],
])('parses %j', (text, origin, dest) => {
  expect(parseNavigation(text)).toMatchObject({ originText: origin, destText: dest });
});

// Existing phrasings must keep working.
test.each([
  ['route from Jakarta to Bandung', 'Jakarta', 'Bandung'],
  ['directions to Grand Indonesia', null, 'Grand Indonesia'],
  ['from my place to Grand Indonesia will it rain', null, 'Grand Indonesia'],
])('still parses %j', (text, origin, dest) => {
  expect(parseNavigation(text)).toMatchObject({ originText: origin, destText: dest });
});

test('"towards" is not shadowed by the shorter "to"', () => {
  expect(parseNavigation('route from Jakarta towards Bandung')).toMatchObject({
    originText: 'Jakarta',
    destText: 'Bandung',
  });
});

test('non-navigation messages are still ignored', () => {
  expect(parseNavigation('what is the weather in Tokyo')).toBeNull();
  expect(parseNavigation('remind me to close the windows at 6pm')).toBeNull();
});

test('rain intent is detected', () => {
  expect(parseNavigation('route from here into Bandung, will it rain?')).toMatchObject({ asksRain: true });
});

describe('departure time', () => {
  test('no time means leaving now', () => {
    expect(parseNavigation('route to Bandung').departAt).toBeNull();
  });

  test('"at 6pm" sets departure and stays out of the place name', () => {
    const nav = parseNavigation('route to Grand Indonesia at 6pm');
    expect(nav.destText).toBe('Grand Indonesia'); // not "Grand Indonesia at 6pm"
    expect(new Date(nav.departAt).getHours()).toBe(18);
  });

  test('"in 2 hours" sets departure and stays out of the place name', () => {
    const nav = parseNavigation('route to Bandung in 2 hours');
    expect(nav.destText).toBe('Bandung');
    expect(nav.departAt - Date.now()).toBeGreaterThan(1.9 * 3600000);
  });

  // "at" is not always a time — a place can be named after one.
  test('a place name containing "at" is not mistaken for a time', () => {
    const nav = parseNavigation('route to Terminal 3 at Soekarno Hatta');
    expect(nav.destText).toBe('Terminal 3 at Soekarno Hatta');
    expect(nav.departAt).toBeNull();
  });
});
