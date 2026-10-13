// Google Places path: the server proxy (api/_lib/core.js) and the browser's
// suggestion source (placeSuggest). Lives under src/ because CRA's jest only
// discovers tests there.
import { placeSuggest, resetPlaceSuggest } from './GeoService';

const core = require('../../api/_lib/core');

const okJson = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });

const googlePlaces = {
  places: [
    {
      displayName: { text: 'Grand Indonesia' },
      shortFormattedAddress: 'Jl. M.H. Thamrin No.1, Jakarta',
      location: { latitude: -6.1951, longitude: 106.8221 },
    },
    {
      displayName: { text: 'Grand Indonesia East Mall' },
      formattedAddress: 'Grand Indonesia East Mall, Jakarta Pusat',
      location: { latitude: -6.1957, longitude: 106.8218 },
    },
    { displayName: { text: 'No coordinates' } },
  ],
};

describe('server geocode proxy with Google Places', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  test('suggest mode answers 501 without a key, so the browser falls back', async () => {
    global.fetch = jest.fn();
    const out = await core.geocodeHandler('grand ind', null, 6, 'suggest');
    expect(out.status).toBe(501);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('with a key, suggest mode queries Google Text Search with a location bias', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue(okJson(googlePlaces));
    const out = await core.geocodeHandler('grand ind', '-6.2,106.8', 6, 'suggest');

    expect(out.status).toBe(200);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(init.headers['X-Goog-Api-Key']).toBe('test-key');
    expect(init.headers['X-Goog-FieldMask']).toContain('places.location');
    const body = JSON.parse(init.body);
    expect(body.textQuery).toBe('grand ind');
    expect(body.locationBias.circle.center).toEqual({ latitude: -6.2, longitude: 106.8 });

    // Places without coordinates are dropped; the two malls are 70m apart, so
    // dedupe keeps the first; the label adds the address the name doesn't repeat.
    expect(out.body.candidates).toEqual([
      {
        name: 'Grand Indonesia',
        label: 'Grand Indonesia, Jl. M.H. Thamrin No.1, Jakarta',
        lat: -6.1951,
        lon: 106.8221,
        source: 'google',
      },
    ]);
  });

  test('normal search tries Google first and stops when it has enough', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    global.fetch = jest.fn().mockResolvedValue(okJson(googlePlaces));
    const out = await core.geocodeHandler('grand indonesia', null, 1);
    expect(out.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(out.body.candidates[0].source).toBe('google');
  });

  test('a Google error falls through to the OSM providers', async () => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(okJson({ error: { code: 403 } }, 403))
      .mockResolvedValue(okJson({ features: [{ properties: { name: 'Monas', city: 'Jakarta' }, geometry: { coordinates: [106.8272, -6.1754] } }] }));
    const out = await core.geocodeHandler('monas', null, 1);
    expect(out.body.candidates[0].name).toBe('Monas');
    expect(global.fetch.mock.calls[1][0]).toMatch(/photon\.komoot\.io/);
  });
});

describe('placeSuggest in the browser', () => {
  const photon = (name) => okJson({ features: [{ properties: { name }, geometry: { coordinates: [106.8, -6.2] } }] });
  beforeEach(() => resetPlaceSuggest());

  test('uses the proxy’s Google suggestions when available', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(
      okJson({ candidates: [{ name: 'Grand Indonesia', label: 'Grand Indonesia, Jakarta', lat: -6.1951, lon: 106.8221, source: 'google' }] })
    );
    const out = await placeSuggest('grand ind', { lat: -6.2, lon: 106.8 });
    expect(global.fetch.mock.calls[0][0]).toMatch(/^\/api\/geocode\?q=grand%20ind&limit=6&mode=suggest&near=-6\.2,106\.8$/);
    expect(out[0].source).toBe('google');
  });

  test('a 501 parks Google and falls back to Photon, without retrying each keystroke', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(okJson({ error: 'google_not_configured' }, 501)).mockResolvedValue(photon('Pontianak'));
    expect((await placeSuggest('ponti', null))[0].name).toBe('Pontianak');
    expect(global.fetch.mock.calls[1][0]).toMatch(/photon\.komoot\.io/);

    global.fetch.mockClear();
    await placeSuggest('pontia', null);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toMatch(/photon\.komoot\.io/);
  });

  test('an empty Google answer still lets Photon try', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(okJson({ candidates: [] })).mockResolvedValue(photon('Kampung X'));
    expect((await placeSuggest('kampung x', null))[0].name).toBe('Kampung X');
  });
});
