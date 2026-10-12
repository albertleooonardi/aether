import { answer, routeSummary, parseReminder } from './assistant';

// Mirrors the shape App.js builds.
const weather = {
  temp: 28,
  feels_like: 30,
  description: 'Clear',
  city: 'Jembatanmerah',
  humidity: 89,
  wind: 16,
  windDir: 'NW',
  gust: 20,
  uv: 0,
  isDay: 0,
  dewpoint: 21,
  chanceOfRain: 8,
  todayLow: 25,
  todayHigh: 33,
  sunrise: '05:32 AM',
  sunset: '05:48 PM',
};

// These rules are first-match-wins, so a broad rule placed above a specific one
// silently swallows it.
describe('rule ordering', () => {
  test('"What should I wear today?" gives clothing advice, not a forecast dump', () => {
    const out = answer('What should I wear today?', weather);
    expect(out).toMatch(/clothing|jacket|layers/i);
    // The `today` forecast rule used to win, answering a question about clothes
    // with a temperature range and nothing else.
    expect(out).not.toBe('Today in Jembatanmerah: clear, 25°–33°, 8% chance of rain.');
  });

  test('"should I take an umbrella?" is still answered about rain', () => {
    expect(answer('should I take an umbrella?', weather)).toMatch(/chance of rain/i);
  });

  // t.includes('rain') fired inside "train", "terrain" and "Ukraine", and the rain
  // rule sits above the clothing and temperature rules that should have answered.
  test('"what should I wear on the train" is about clothes, not rain', () => {
    const out = answer('what should I wear on the train', weather);
    expect(out).not.toMatch(/chance of rain today/);
    expect(out).toMatch(/clothing|jacket|layers/i);
  });

  test('"do I need a jacket on the train?" is about clothes, not rain', () => {
    expect(answer('do I need a jacket on the train?', weather)).toMatch(/clothing|jacket|layers/i);
  });

  test('"is Ukraine cold?" is answered with the temperature', () => {
    const out = answer('is Ukraine cold?', weather);
    expect(out).not.toMatch(/chance of rain today/);
    expect(out).toMatch(/It's 28° in Jembatanmerah/);
  });

  test('real rain questions still reach the rain rule', () => {
    expect(answer('is it raining?', weather)).toMatch(/chance of rain today/);
    expect(answer('will it rain later', weather)).toMatch(/chance of rain today/);
  });

  test('a plain forecast question still gets the forecast', () => {
    expect(answer("what's the forecast?", weather)).toMatch(/Today in Jembatanmerah/);
  });
});

// The UV rule tested t.includes('sun'), so "what time is sunset" was answered
// with the UV index even though App.js puts the astro times on the weather object.
describe('sunrise and sunset', () => {
  test.each(['what time is sunset', 'when does the sun set', 'what time is sunrise'])('%j gives the times, not the UV index', (text) => {
    const out = answer(text, weather);
    expect(out).not.toMatch(/UV index/);
    expect(out).toBe('In Jembatanmerah, sunrise is at 05:32 AM and sunset at 05:48 PM.');
  });

  // Tightening the UV test must not cost it the words that really are UV
  // questions. Asserted on the ROUTING rather than the wording: the fixture's
  // uv is 0, which now reads "No UV right now" instead of quoting the index, and
  // the thing this guards is that these reach the UV rule and not the astro one.
  test.each(['what is the uv index', 'is it sunny?', 'do I need sunscreen', 'will I get sunburn'])(
    '%j still gets the UV rule, not the sunrise/sunset rule',
    (text) => {
      const out = answer(text, weather);
      expect(out).toMatch(/UV/);
      expect(out).not.toMatch(/sunrise is at/);
    }
  );

  test.each(['what is the uv index', 'is it sunny?', 'do I need sunscreen', 'will I get sunburn'])(
    '%j quotes the actual index when the sun is up',
    (text) => {
      expect(answer(text, { ...weather, isDay: 1, uv: 7 })).toMatch(/UV index is 7/);
    }
  );

  test('missing astro data is admitted, not printed as "undefined"', () => {
    const noAstro = { ...weather, sunrise: null, sunset: null };
    expect(answer('what time is sunset', noAstro)).toMatch(/don't have sunrise and sunset times/);
  });
});

describe('activity questions', () => {
  test('"Is it a good evening for a run?" gets a verdict, not the generic fallback', () => {
    const out = answer('Is it a good evening for a run?', weather);
    expect(out).not.toMatch(/I can help with rain, temperature/);
    expect(out).toMatch(/Jembatanmerah/);
    // 89% humidity is the thing worth flagging for a run.
    expect(out).toMatch(/89% humidity/);
  });

  test('good conditions read as good', () => {
    const nice = { ...weather, humidity: 55, temp: 24, chanceOfRain: 5 };
    expect(answer('is it ok to go for a walk?', nice)).toMatch(/good conditions/i);
  });

  test('rain and heat are called out for a cycle', () => {
    const bad = { ...weather, chanceOfRain: 70, temp: 34, humidity: 85 };
    const out = answer('should I cycle to work?', bad);
    expect(out).toMatch(/70% chance of rain/);
    expect(out).toMatch(/34° heat/);
  });

  test('UV only matters during the day', () => {
    const night = { ...weather, uv: 9, isDay: 0, humidity: 50 };
    expect(answer('good for a run?', night)).not.toMatch(/UV/);
    const day = { ...weather, uv: 9, isDay: 1, humidity: 50 };
    expect(answer('good for a run?', day)).toMatch(/UV index of 9/);
  });
});

test('without weather loaded it asks for a city rather than inventing one', () => {
  expect(answer('is it a good evening for a run?', null)).toMatch(/Search for a city/);
});

describe('routeSummary', () => {
  const D = 'Grand Indonesia';
  test('dry', () =>
    expect(routeSummary(D, 'dry')).toBe('**Grand Indonesia** — stays dry the whole way, no umbrella needed.'));
  test('light', () =>
    expect(routeSummary(D, 'light')).toBe('**Grand Indonesia** — a little light rain on the way, maybe pack an umbrella.'));
  test('wet', () =>
    expect(routeSummary(D, 'wet')).toBe("**Grand Indonesia** — rain forecast while you'd be driving, take an umbrella."));
  test('unknown', () =>
    expect(routeSummary(D, 'unknown')).toBe("**Grand Indonesia** — I couldn't check rain along this route."));
  test('departAt appends the leaving time only when given', () => {
    const t = new Date(2026, 9, 11, 18, 0).getTime();
    expect(routeSummary(D, 'dry', t)).toMatch(/ Leaving 6:00 PM\.$/);
    expect(routeSummary(D, 'dry')).not.toMatch(/Leaving/);
  });
  test('stays a single line anchored on the destination', () => {
    expect(routeSummary(D, 'wet')).not.toContain('\n');
  });
});

// parseReminder stripped "remind me to" without anchoring it, so a polite lead-in
// survived into the label the notification shows: "Can you remind me to bring an
// umbrella at 5pm?" fired a reminder reading "Can you  bring an umbrella ?".
// "set a reminder to …" was worse — it cleared the includes('remind') gate while
// matching no strip pattern, so the whole sentence became the label.
describe('reminder labels are the task, not the phrasing', () => {
  const label = (s) => parseReminder(s).label;

  test('a polite lead-in is stripped', () => {
    expect(label('Can you remind me to bring an umbrella at 5pm?')).toBe('bring an umbrella');
    expect(label('could you remind me to bring an umbrella at 5pm')).toBe('bring an umbrella');
    expect(label('would you please remind me to bring an umbrella at 5pm')).toBe('bring an umbrella');
    expect(label('please remind me to bring an umbrella at 5pm')).toBe('bring an umbrella');
  });

  test('"set a reminder to X" yields X, not the whole sentence', () => {
    expect(label('set a reminder to bring an umbrella at 5pm')).toBe('bring an umbrella');
    expect(label('add a reminder to close the windows at 6pm')).toBe('close the windows');
  });

  test('the plain phrasings still work', () => {
    expect(label('remind me to bring an umbrella at 5pm')).toBe('bring an umbrella');
    expect(label('remind me at 5pm to bring an umbrella')).toBe('bring an umbrella');
    expect(label('remind me in 30 minutes to check the radar')).toBe('check the radar');
  });

  test('no label left over still reads as something', () => {
    expect(label('remind me at 5pm')).toBe('your reminder');
  });

  test('the due time is unaffected by the label fix', () => {
    const a = parseReminder('remind me to bring an umbrella at 5pm');
    const b = parseReminder('Can you remind me to bring an umbrella at 5pm?');
    expect(b.dueEpoch).toBe(a.dueEpoch);
  });
});

// The UV reply split at a single threshold of 6, so UV 0 — which is what the
// index always is after dark — was described as "Moderate to low".
describe('UV wording', () => {
  const wx = (over) => ({ city: 'Jakarta', uv: 0, uvMax: 8, isDay: 0, ...over });

  test('there is no UV at night, and the daytime peak is offered instead', () => {
    const out = answer('what is the uv index', wx());
    expect(out).toMatch(/no uv right now/i);
    expect(out).not.toMatch(/moderate to low/i);
    expect(out).toContain('8');
  });

  test('a daytime zero is also not "moderate"', () => {
    expect(answer('uv?', wx({ isDay: 1, uv: 0 }))).toMatch(/no uv right now/i);
  });

  test('the WHO bands are distinguished rather than lumped together', () => {
    expect(answer('uv?', wx({ isDay: 1, uv: 2 }))).toMatch(/low/i);
    expect(answer('uv?', wx({ isDay: 1, uv: 4 }))).toMatch(/moderate/i);
    expect(answer('uv?', wx({ isDay: 1, uv: 7 }))).toMatch(/high/i);
    expect(answer('uv?', wx({ isDay: 1, uv: 9 }))).toMatch(/very high/i);
    expect(answer('uv?', wx({ isDay: 1, uv: 11 }))).toMatch(/extreme/i);
  });
});
