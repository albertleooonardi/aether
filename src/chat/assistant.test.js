import { answer } from './assistant';

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

  // Tightening the UV test must not cost it the words that really are UV questions.
  test.each(['what is the uv index', 'is it sunny?', 'do I need sunscreen', 'will I get sunburn'])(
    '%j still gets the UV index',
    (text) => {
      expect(answer(text, weather)).toMatch(/UV index is 0/);
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
