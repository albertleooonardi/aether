import { parseNavigation, parseMapsUrl, parseWeatherIn, parseFollowUp } from './intents';

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

  // The capture ran greedily to the next punctuation mark, so a filler head or a
  // trailing clause with no comma before it went to the geocoder verbatim.
  test.each([
    ['is the weather good for running in Bandung', 'Bandung'],
    ['will it rain in Bandung on my way home', 'Bandung'],
  ])('%j -> %j', (text, place) => {
    expect(parseWeatherIn(text)).toBe(place);
  });

  test('current-location questions stay with the current location', () => {
    expect(parseWeatherIn('what is the weather in my area')).toBeNull();
    expect(parseWeatherIn('is it hot here')).toBeNull();
  });

  // The trailing-time-word strip needs a leading \s+, so it only removed a time
  // word that followed a place. When the capture WAS the time word, "tomorrow"
  // was handed to the geocoder as if it were a city.
  test.each(['what is the forecast for tomorrow', 'what is the forecast for today', 'will it rain in the afternoon'])(
    '%j names no place',
    (text) => {
      expect(parseWeatherIn(text)).toBeNull();
    }
  );

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

// STOP treated every dot as a clause terminator, so an abbreviated address —
// ordinary input in this locale — was cut down to its first two letters and the
// geocoder was handed "Jl".
test.each([
  ['navigate to Jl. Tunjungan No. 1', 'Jl. Tunjungan No. 1'],
  ['route to Dr. Soetomo Hospital', 'Dr. Soetomo Hospital'],
  ['directions to St. Mary Hospital', 'St. Mary Hospital'],
  ['route from Jl. Basuki Rahmat to Jl. Tunjungan', 'Jl. Tunjungan'],
])('keeps the abbreviation dot in %j', (text, dest) => {
  expect(parseNavigation(text).destText).toBe(dest);
});

// A dot that really does end a sentence must still terminate the clause.
test('a sentence-ending dot still terminates the destination', () => {
  expect(parseNavigation('route to Bandung. Thanks').destText).toBe('Bandung');
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

// "when I'm going to X" is how people actually ask about rain on a trip. Only
// route/directions/drive counted as navigation, so these fell through to a
// generic current-city rain reply that ignored the destination entirely.
test.each([
  ['Is there any rain later when im going to Maspion Plaza', 'Maspion Plaza'],
  ['any rain when I’m going to Central Park?', 'Central Park'],
  ['will it rain when we go to Bandung tomorrow', 'Bandung'],
  ['omw to Grand Indonesia, do I need an umbrella?', 'Grand Indonesia'],
  ['I am visiting Kota Tua at 6pm, will it be wet?', 'Kota Tua'],
])('parses trip phrasing %j', (text, dest) => {
  expect(parseNavigation(text)).toMatchObject({ destText: dest, asksRain: true });
});

// NAV is used inside \b…\b, so a bare "commute"/"travel" alternative could never
// match an inflected form: "travelling to Malang, will it rain?" was not recognised
// as navigation at all and fell through to a current-city rain reply.
test.each([
  ['travelling to Malang tomorrow, will it rain?', 'Malang'],
  ['traveling to Malang, will it rain?', 'Malang'],
  ['commuting to Bandung, any rain?', 'Bandung'],
])('parses inflected nav verbs %j', (text, dest) => {
  expect(parseNavigation(text)).toMatchObject({ destText: dest, asksRain: true });
});

// "going to" is also future tense — these must NOT become routes to "rain"/"be".
test.each(['is it going to rain today', 'is it going to be hot tomorrow', 'going to rain in Tokyo?'])(
  'future tense %j is not navigation',
  (text) => {
    expect(parseNavigation(text)).toBeNull();
  }
);

test('future-tense rain question still resolves its place', () => {
  expect(parseWeatherIn('is it going to rain in Tokyo?')).toBe('Tokyo');
});

describe('parseFollowUp', () => {
  test.each([
    ['what about Central Park?', 'Central Park'],
    ['How about Bandung', 'Bandung'],
    ['and Surabaya?', 'Surabaya'],
    ['what about Central Park, will it rain?', 'Central Park'],
  ])('%j names a new place', (text, place) => {
    expect(parseFollowUp(text)).toMatchObject({ place });
  });

  test('"what about at 8pm" changes only the time', () => {
    const fu = parseFollowUp('what about at 8pm');
    expect(fu.place).toBeUndefined();
    expect(new Date(fu.departAt).getHours()).toBe(20);
  });

  test('"how about in 2 hours" changes only the time', () => {
    const fu = parseFollowUp('how about in 2 hours');
    expect(fu.departAt - Date.now()).toBeGreaterThan(1.9 * 3600000);
  });

  test.each([
    'what about tomorrow',
    'and will it rain',
    'what about the rain',
    'is it raining',
    'what about here',
  ])('%j is not a place follow-up', (text) => {
    expect(parseFollowUp(text)).toBeNull();
  });
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
