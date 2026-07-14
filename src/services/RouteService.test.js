import { getRoutes, assessRain } from './RouteService';
import { fetchCurrent } from './WeatherService';

jest.mock('./WeatherService', () => ({ fetchCurrent: jest.fn() }));

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

/* ---------------- rain assessment ---------------- */

const route = { coordinates: [[-6.1, 106.8], [-6.5, 107.1], [-6.9, 107.6]] };
const conditions = (code, precip_mm = 0) => ({ current: { precip_mm, condition: { code } } });

test('"Patchy rain nearby" (1063) is not rain — the tropics are not permanently wet', async () => {
  // The old text match counted this, so every route came back "wet".
  fetchCurrent.mockResolvedValue(conditions(1063, 0));

  const rain = await assessRain(route);
  expect(rain).toMatchObject({ rainy: 0, level: 'dry' });
});

test('"Thundery outbreaks in nearby" (1087) is not rain either', async () => {
  fetchCurrent.mockResolvedValue(conditions(1087, 0));

  expect(await assessRain(route)).toMatchObject({ rainy: 0, level: 'dry' });
});

test('drizzle (1153) counts as rain even though its label omits the word', async () => {
  // The old text match missed this entirely.
  fetchCurrent.mockResolvedValue(conditions(1153, 0.2));

  const rain = await assessRain(route);
  expect(rain.rainy).toBe(3);
  expect(rain.level).toBe('wet');
});

test('actual moderate rain still reports wet', async () => {
  fetchCurrent.mockResolvedValue(conditions(1189, 1.5));

  expect(await assessRain(route)).toMatchObject({ rainy: 3, level: 'wet' });
});

test('a single light-rain point reads as light, not a downpour', async () => {
  fetchCurrent
    .mockResolvedValueOnce(conditions(1183, 0.1))
    .mockResolvedValueOnce(conditions(1000, 0))
    .mockResolvedValueOnce(conditions(1003, 0));

  expect(await assessRain(route)).toMatchObject({ rainy: 1, level: 'light' });
});

test('when every sample fails it reports unknown, not a confident "dry"', async () => {
  fetchCurrent.mockRejectedValue(new Error('quota exceeded'));

  expect(await assessRain(route)).toMatchObject({ samples: 0, level: 'unknown' });
});
