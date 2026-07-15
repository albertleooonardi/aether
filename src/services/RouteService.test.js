import { getRoutes, assessRain } from './RouteService';
import { fetchForecastHours } from './WeatherService';

jest.mock('./WeatherService', () => ({ fetchForecastHours: jest.fn() }));

// OSRM signals "no road connects these points" as HTTP 400 with a JSON body, so
// status alone can't tell a real outage from a definitive answer.
const osrmRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (body === null) throw new Error('not json');
    return body;
  },
});

const JKT = { lat: -6.1944, lon: 106.8213 };
const BDG = { lat: -6.9218, lon: 107.607 };

// Every case falls through the /api proxy to the direct OSRM call.
const proxyDown = () => Promise.reject(new Error('backend down'));

afterEach(() => jest.restoreAllMocks());

test('NoRoute (HTTP 400 + code) reports no_route, not a service outage', async () => {
  global.fetch = jest
    .fn()
    .mockImplementationOnce(proxyDown)
    .mockResolvedValueOnce(osrmRes(400, { code: 'NoRoute', message: 'Impossible route between points' }));

  await expect(getRoutes(JKT, BDG)).rejects.toMatchObject({ code: 'no_route' });
});

test('a genuine outage (bodyless 5xx) still reports unavailable', async () => {
  global.fetch = jest.fn().mockImplementationOnce(proxyDown).mockResolvedValueOnce(osrmRes(503, null));

  await expect(getRoutes(JKT, BDG)).rejects.toMatchObject({
    code: 'unavailable',
    message: 'Routing service unavailable',
  });
});

test('a rate-limited proxy falls through to OSRM and still routes', async () => {
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce(osrmRes(502, { error: 'routing_unavailable' })) // proxy gave up
    .mockResolvedValueOnce(
      osrmRes(200, {
        code: 'Ok',
        routes: [{ geometry: { coordinates: [[106.8, -6.1], [107.6, -6.9]] }, distance: 150000, duration: 9000 }],
      })
    );

  const [route] = await getRoutes(JKT, BDG);
  // GeoJSON is [lng, lat]; Leaflet wants [lat, lng].
  expect(route.coordinates).toEqual([[-6.1, 106.8], [-6.9, 107.6]]);
  expect(route.distanceKm).toBe(150);
  expect(route.durationMin).toBe(150);
});

test('non-finite coordinates never reach the network', async () => {
  global.fetch = jest.fn();

  await expect(getRoutes({ lat: undefined, lon: undefined }, BDG)).rejects.toMatchObject({ code: 'bad_coords' });
  expect(global.fetch).not.toHaveBeenCalled();
});

/* ---------------- ETAs along the line ---------------- */

test("ETAs accumulate OSRM's own per-node timings, not an average speed", async () => {
  global.fetch = jest.fn().mockImplementationOnce(proxyDown).mockResolvedValueOnce(
    osrmRes(200, {
      code: 'Ok',
      routes: [
        {
          geometry: { coordinates: [[106.8, -6.1], [106.9, -6.2], [107.0, -6.3], [107.6, -6.9]] },
          distance: 150000,
          duration: 700,
          // A slow crawl, then a fast motorway leg.
          legs: [{ annotation: { duration: [600, 60, 40] } }],
        },
      ],
    })
  );

  const [route] = await getRoutes(JKT, BDG);
  expect(route.etaSeconds).toEqual([0, 600, 660, 700]);
});

test('a route without annotations still gets usable ETAs', async () => {
  global.fetch = jest.fn().mockImplementationOnce(proxyDown).mockResolvedValueOnce(
    osrmRes(200, {
      code: 'Ok',
      routes: [
        {
          geometry: { coordinates: [[106.8, -6.1], [106.9, -6.2], [107.6, -6.9]] },
          distance: 150000,
          duration: 900,
        },
      ],
    })
  );

  const [route] = await getRoutes(JKT, BDG);
  // Evenly spread rather than treating arrival as instantaneous.
  expect(route.etaSeconds).toEqual([0, 450, 900]);
});

/* ---------------- rain assessment ---------------- */

// A real OSRM route is a dense line; 20 points keeps the chunk maths meaningful.
const line = Array.from({ length: 20 }, (_, i) => [-6.1 - i * 0.04, 106.8 + i * 0.04]);

const DEPART = Date.UTC(2026, 6, 16, 10, 0, 0); // 10:00 UTC
const HOUR = 3600000;

// Route where every vertex is reachable at `departAt` + its index in minutes, so a
// test can place weather at a precise point in the drive.
const route = { coordinates: line, distanceKm: 7.8, etaSeconds: line.map((_, i) => i * 60) };

// One WeatherAPI forecast hour.
const hour = (epochMs, { code = 1000, precip = 0, chance = 0 } = {}) => ({
  time_epoch: Math.floor(epochMs / 1000),
  condition: { code },
  precip_mm: precip,
  chance_of_rain: chance,
});

// A day of hours around departure, all the same, unless `override` says otherwise.
const forecast = (base = {}, override = () => null) =>
  Array.from({ length: 12 }, (_, i) => {
    const at = DEPART - 2 * HOUR + i * HOUR;
    return hour(at, { ...base, ...(override(at) || {}) });
  });

test('"Patchy rain nearby" (1063) is not rain — the tropics are not permanently wet', async () => {
  // The old text match counted this, so every route came back "wet".
  fetchForecastHours.mockResolvedValue(forecast({ code: 1063, precip: 0, chance: 10 }));

  expect(await assessRain(route, DEPART)).toMatchObject({ rainy: 0, level: 'dry' });
});

test('a low chance with no accumulation is dry, not a warning', async () => {
  fetchForecastHours.mockResolvedValue(forecast({ code: 1000, precip: 0, chance: 20 }));

  expect(await assessRain(route, DEPART)).toMatchObject({ level: 'dry', chance: 20 });
});

test('a high chance of rain is called out even before it is falling', async () => {
  // The point of forecasting: 80% chance at the hour you would be there.
  fetchForecastHours.mockResolvedValue(forecast({ code: 1063, precip: 0, chance: 80 }));

  expect(await assessRain(route, DEPART)).toMatchObject({ level: 'wet' });
});

test('drizzle (1153) counts as rain even though its label omits the word', async () => {
  fetchForecastHours.mockResolvedValue(forecast({ code: 1153, precip: 0.2, chance: 40 }));

  const rain = await assessRain(route, DEPART);
  expect(rain.rainy).toBe(3);
  expect(rain.level).toBe('light');
});

test('forecast rain reports wet', async () => {
  fetchForecastHours.mockResolvedValue(forecast({ code: 1189, precip: 1.5, chance: 90 }));

  expect(await assessRain(route, DEPART)).toMatchObject({ rainy: 3, level: 'wet' });
});

test('when every sample fails it reports unknown, not a confident "dry"', async () => {
  fetchForecastHours.mockRejectedValue(new Error('quota exceeded'));

  expect(await assessRain(route, DEPART)).toMatchObject({ samples: 0, level: 'unknown' });
});

test('an ETA past the forecast horizon reports unknown rather than guessing', async () => {
  fetchForecastHours.mockResolvedValue(forecast({ code: 1000 }));

  // Depart three days out — no forecast hour covers it.
  expect(await assessRain(route, DEPART + 72 * HOUR)).toMatchObject({ samples: 0, level: 'unknown' });
});

/* ---------------- the point: weather is judged at arrival time ---------------- */

// This is what "are you sure it's always dry?" was really asking. Conditions now
// say nothing about conditions when the driver actually gets there.
test('rain arriving later is caught, even though it is dry at departure', async () => {
  // Dry until 11:00 UTC, pouring after.
  fetchForecastHours.mockResolvedValue(
    forecast({ code: 1000, precip: 0, chance: 0 }, (at) =>
      at >= DEPART + HOUR ? { code: 1195, precip: 4, chance: 95 } : null
    )
  );

  // A two-hour drive: the far stretches land in the downpour.
  const long = { coordinates: line, distanceKm: 120, etaSeconds: line.map((_, i) => (i / 19) * 7200) };
  const rain = await assessRain(long, DEPART);

  expect(rain.level).toBe('wet');
  expect(rain.segments.some((s) => s.level === 'dry')).toBe(true);
  expect(rain.segments.some((s) => s.level === 'wet')).toBe(true);
  // The same drive judged only on conditions at departure would have said "dry".
  expect(rain.segments[0].level).toBe('dry');
});

test('each stretch is asked about its own arrival time', async () => {
  fetchForecastHours.mockResolvedValue(forecast({ code: 1000 }));

  const { segments } = await assessRain(route, DEPART);
  // etaSeconds is index*60, so later stretches are asked about later instants.
  expect(segments[0].at).toBeLessThan(segments[1].at);
  expect(segments[1].at).toBeLessThan(segments[2].at);
  expect(segments[0].at).toBeGreaterThanOrEqual(DEPART);
});

test('a later departure is judged against that later forecast', async () => {
  fetchForecastHours.mockResolvedValue(
    forecast({ code: 1000, precip: 0, chance: 0 }, (at) =>
      at >= DEPART + 2 * HOUR ? { code: 1195, precip: 4, chance: 95 } : null
    )
  );

  expect((await assessRain(route, DEPART)).level).toBe('dry');
  expect((await assessRain(route, DEPART + 2 * HOUR)).level).toBe('wet');
});

/* ---------------- per-segment "heat" data ---------------- */

test('rain is reported per stretch, so the map can paint only the wet part red', async () => {
  const dry = forecast({ code: 1000, precip: 0, chance: 0 });
  const wet = forecast({ code: 1195, precip: 3, chance: 95 });
  fetchForecastHours
    .mockResolvedValueOnce(dry)
    .mockResolvedValueOnce(wet) // heavy rain over the middle stretch
    .mockResolvedValueOnce(dry);

  const { segments, level } = await assessRain(route, DEPART);
  expect(segments.map((s) => s.level)).toEqual(['dry', 'wet', 'dry']);
  // One soaked stretch is enough to warrant an umbrella.
  expect(level).toBe('wet');
});

test('segments tile the whole line without gaps or overlaps', async () => {
  fetchForecastHours.mockResolvedValue(forecast({ code: 1000 }));

  const { segments } = await assessRain(route, DEPART);
  expect(segments[0].from).toBe(0);
  expect(segments[segments.length - 1].to).toBe(line.length - 1);
  // Each segment must start exactly where the previous ended, or the drawn line
  // shows gaps between colours.
  segments.slice(1).forEach((s, i) => expect(s.from).toBe(segments[i].to));
});

test('a longer route is chunked more finely, but stays capped', async () => {
  fetchForecastHours.mockResolvedValue(forecast({ code: 1000 }));

  const long = await assessRain({ ...route, distanceKm: 400 }, DEPART);
  expect(long.segments).toHaveLength(8);

  const short = await assessRain({ ...route, distanceKm: 2 }, DEPART);
  expect(short.segments).toHaveLength(3);
});

test('a route with no distance still gets sampled', async () => {
  fetchForecastHours.mockResolvedValue(forecast({ code: 1000 }));

  const rain = await assessRain({ coordinates: line, etaSeconds: route.etaSeconds }, DEPART);
  expect(rain.segments).toHaveLength(3);
  expect(rain.level).toBe('dry');
});

// Sample count scales with length, so a summed score would rank a long route
// wetter than a short one in identical weather.
test('score does not punish a route for being long', async () => {
  fetchForecastHours.mockResolvedValue(forecast({ code: 1183, precip: 0.2, chance: 50 }));

  const short = await assessRain({ ...route, distanceKm: 5 }, DEPART);
  const long = await assessRain({ ...route, distanceKm: 400 }, DEPART);
  expect(short.segments.length).toBeLessThan(long.segments.length);
  expect(long.score).toBeCloseTo(short.score, 5);
});
