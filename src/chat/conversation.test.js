// Conversation backtest: replay realistic chats through the same decision
// pipeline ChatWidget uses (reminder → navigation → weather-in → follow-up →
// local fallback) and check each reply actually answers the question asked —
// the screenshot bug was "rain when going to Maspion Plaza?" being answered
// with the current city's daily rain number.
import { parseReminder, answer } from './assistant';
import { parseNavigation, parseWeatherIn, parseFollowUp } from './intents';

// Mirrors handleSubmit's routing order. Network handlers aren't run — what we
// assert is that each message reaches the RIGHT handler with the RIGHT data.
const route = (text) => {
  const rem = parseReminder(text);
  if (rem) return { kind: 'reminder', ...rem };
  const nav = parseNavigation(text);
  if (nav) return { kind: 'route', ...nav };
  const place = parseWeatherIn(text);
  if (place) return { kind: 'weather-in', place };
  const fu = parseFollowUp(text);
  if (fu) return { kind: 'follow-up', ...fu };
  return { kind: 'fallback' };
};

// The same shape App.js builds and ChatWidget receives.
const weather = {
  city: 'Jembatanmerah',
  country: 'Indonesia',
  temp: 31,
  feels_like: 35,
  description: 'Smoky haze',
  humidity: 70,
  wind: 9,
  windDir: 'NE',
  gust: 14,
  uv: 7,
  dewpoint: 24,
  isDay: 1,
  chanceOfRain: 4,
  todayHigh: 33,
  todayLow: 26,
};
const hourlyDry = [
  { time: '2026-07-16 17:00', temp: 31, weather: 'Smoky haze', chanceOfRain: 4 },
  { time: '2026-07-16 18:00', temp: 30, weather: 'Haze', chanceOfRain: 6 },
  { time: '2026-07-16 19:00', temp: 29, weather: 'Clear', chanceOfRain: 5 },
];
const hourlyRainAt8 = [
  { time: '2026-07-16 17:00', temp: 31, weather: 'Cloudy', chanceOfRain: 10 },
  { time: '2026-07-16 20:00', temp: 27, weather: 'Light rain', chanceOfRain: 72 },
];
const forecast = [
  { date: new Date('2026-07-17'), high: 32, low: 25, weather: 'Patchy rain nearby', chanceOfRain: 65 },
];

describe('the screenshot conversation now reaches the route handler', () => {
  test('rain on the way to Maspion Plaza is a route question, not current-city weather', () => {
    expect(route('Is there any rain later when im going to Maspion Plaza')).toMatchObject({
      kind: 'route',
      destText: 'Maspion Plaza',
      asksRain: true,
    });
  });

  test('the immediate rephrasing to Central Park routes there too', () => {
    expect(route('Is there any rain later when im going to Central Park')).toMatchObject({
      kind: 'route',
      destText: 'Central Park',
      asksRain: true,
    });
  });
});

describe('a longer session routes every turn to the matching handler', () => {
  test.each([
    ['hi', 'fallback', {}],
    ['Weather in Surabaya', 'weather-in', { place: 'Surabaya' }],
    ['what about Bandung?', 'follow-up', { place: 'Bandung' }],
    ['Route from my place to Grand Indonesia — will it rain?', 'route', { destText: 'Grand Indonesia', asksRain: true }],
    ['how about at 8pm', 'follow-up', {}],
    ['any rain when I’m going to Kota Tua?', 'route', { destText: 'Kota Tua', asksRain: true }],
    ['Remind me to bring an umbrella at 5pm', 'reminder', { label: 'bring an umbrella' }],
    ['is it going to rain today', 'fallback', {}],
    ['is it going to rain in Tokyo', 'weather-in', { place: 'Tokyo' }],
    ['what should I wear today?', 'fallback', {}],
    // "tomorrow" is a time, not a city — this used to be geocoded as a place.
    ['what is the forecast for tomorrow', 'fallback', {}],
  ])('%j → %s', (text, kind, extra) => {
    expect(route(text)).toMatchObject({ kind, ...extra });
  });

  test('"how about at 8pm" carries an 8 PM departure for the previous route', () => {
    const fu = route('how about at 8pm');
    expect(new Date(fu.departAt).getHours()).toBe(20);
  });
});

describe('fallback answers use the app data, and match the question', () => {
  test('"will it rain later" reads the hourly data, not the daily number', () => {
    const reply = answer('will it rain later', weather, [], hourlyRainAt8, forecast);
    expect(reply).toMatch(/8 PM/);
    expect(reply).toMatch(/72%/);
    expect(reply).toMatch(/umbrella/i);
  });

  test('a dry evening is reported as dry, with the peak hourly chance', () => {
    const reply = answer('do I need an umbrella tonight', weather, [], hourlyDry, forecast);
    expect(reply).toMatch(/No rain expected/i);
    expect(reply).toMatch(/6%/);
  });

  test('"will it rain tomorrow" answers from tomorrow\'s forecast, not today\'s 4%', () => {
    const reply = answer('will it rain tomorrow', weather, [], hourlyDry, forecast);
    expect(reply).toMatch(/Tomorrow/);
    expect(reply).toMatch(/65%/);
    expect(reply).not.toMatch(/\b4%/);
  });

  test('"what is the forecast for tomorrow" is answered from tomorrow\'s forecast', () => {
    const reply = answer('what is the forecast for tomorrow', weather, [], hourlyDry, forecast);
    expect(reply).toMatch(/Tomorrow in Jembatanmerah/);
    expect(reply).toMatch(/65%/);
  });

  test('temperature question answers with temperature', () => {
    const reply = answer('how hot is it', weather, [], hourlyDry, forecast);
    expect(reply).toMatch(/31°/);
    expect(reply).toMatch(/35°/);
  });

  test('wind question answers with wind', () => {
    expect(answer('how windy is it', weather, [], hourlyDry, forecast)).toMatch(/9 km\/h.*NE/);
  });

  test('without hourly data the rain answer degrades to the daily chance', () => {
    expect(answer('will it rain', weather)).toMatch(/4% chance of rain today/);
  });

  test('"humidity of pontianak" asks about Pontianak, not the current city', () => {
    expect(route('What is the humidity of pontianak')).toMatchObject({ kind: 'weather-in', place: 'pontianak' });
  });

  test('"list of raining countries" does not dump the reminder list', () => {
    const reply = answer('Show me the list of raining country today', weather, [{ label: 'x', dueEpoch: Date.now() + 9e6 }]);
    expect(reply).not.toMatch(/reminder/i);
  });

  test('"list of raining places" offline: says it needs the AI, not the current city\'s 4%', () => {
    const reply = answer('Show the list of raining places today', weather, [], hourlyDry, forecast);
    expect(reply).not.toMatch(/Jembatanmerah/);
    expect(reply).toMatch(/one place at a time/i);
  });

  test('"where is it raining" offline gets the same honest answer', () => {
    expect(answer('where is it raining right now', weather, [], hourlyDry, forecast)).toMatch(/basic mode/i);
  });

  test('"my reminders" still lists them', () => {
    const reply = answer('what are my reminders', weather, [{ label: 'stretch', dueEpoch: Date.now() + 9e6 }]);
    expect(reply).toMatch(/stretch/);
  });

  test('a run in smoky haze at feels-like 35° is not called "good conditions"', () => {
    const reply = answer('is it a good evening for a run?', weather, [], hourlyDry, forecast);
    expect(reply).not.toMatch(/good conditions/i);
    expect(reply).toMatch(/smoky haze/i);
    expect(reply).toMatch(/35°/);
  });
});
