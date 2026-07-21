import { coordsFromMapsUrl, geocodeCandidates } from './GeoService';

describe('coordsFromMapsUrl', () => {
  test.each([
    ['the @ pin', 'https://www.google.com/maps/place/Grand+Indonesia/@-6.1958,106.8215,17z/data=!3m1'],
    ['a ?q= link', 'https://maps.google.com/?q=-6.1958,106.8215'],
    ['a ?destination= link', 'https://www.google.com/maps/dir/?api=1&destination=-6.1958,106.8215'],
    ['embedded !3d!4d place data', 'https://www.google.com/maps/place/X/data=!3m1!4b1!3d-6.1958!4d106.8215'],
  ])('reads coordinates from %s', (_, url) => {
    expect(coordsFromMapsUrl(url)).toMatchObject({ lat: -6.1958, lon: 106.8215 });
  });

  test('picks the place name out of the URL', () => {
    const hit = coordsFromMapsUrl('https://www.google.com/maps/place/Grand+Indonesia/@-6.1958,106.8215,17z');
    expect(hit.name).toBe('Grand Indonesia');
  });

  test('a short link carries no coordinates — it must be followed', () => {
    expect(coordsFromMapsUrl('https://maps.app.goo.gl/abc123')).toBeNull();
  });

  test('rejects out-of-range coordinates', () => {
    expect(coordsFromMapsUrl('https://maps.google.com/?q=-999.0,106.8')).toBeNull();
  });
});

describe('geocodeCandidates', () => {
  const photon = (feats) => ({
    ok: true,
    json: async () => ({ features: feats }),
  });
  const feat = (name, lat, lon) => ({
    properties: { name, city: 'Jakarta', country: 'Indonesia' },
    geometry: { coordinates: [lon, lat] },
  });

  afterEach(() => jest.restoreAllMocks());

  test('returns the proxy candidate list', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          { name: 'Grand Indonesia Shopping Town', label: 'a', lat: -6.1958, lon: 106.8215 },
          { name: 'Kantor Pemasaran Grand Duta City', label: 'b', lat: -6.1649, lon: 107.0212 },
        ],
      }),
    });

    const out = await geocodeCandidates('Grand Indonesia', { lat: -6.17, lon: 106.84 });
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe('Grand Indonesia Shopping Town');
  });

  test('falls back to Photon when the proxy is down', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('backend down'))
      .mockResolvedValueOnce(photon([feat('Grand Indonesia Shopping Town', -6.1958, 106.8215)]));

    const out = await geocodeCandidates('Grand Indonesia', null);
    expect(out[0]).toMatchObject({ name: 'Grand Indonesia Shopping Town', lat: -6.1958 });
  });

  // "Central Park" returns the mall plus its fountain, parking and loading dock,
  // spread over ~250m — one destination, not five choices.
  test('collapses a POI and its own sub-features into one choice', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('backend down'))
      .mockResolvedValueOnce(
        photon([
          feat('Central Park Mall', -6.177, 106.791),
          feat('Central Park Mall Musical Fountain', -6.177, 106.791),
          feat('Central Park Mall 2', -6.175, 106.79),
          feat('Parkir Gedung / Basement Central Park Mall', -6.176, 106.79),
          feat('Loading Dock A Central Park Mall', -6.178, 106.789),
        ])
      );

    const out = await geocodeCandidates('Central Park', { lat: -6.176, lon: 106.844 });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Central Park Mall'); // the top-ranked of the cluster
  });

  // A mall and its own sky bridge sit ~110m apart; showing both as separate
  // choices is noise, not a decision.
  test('collapses near-identical candidates', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('backend down'))
      .mockResolvedValueOnce(
        photon([
          feat('Grand Indonesia Shopping Town', -6.1958, 106.8215),
          feat('Grand Indonesia Sky Bridge', -6.1952, 106.8207),
          feat('Kantor Pemasaran Grand Duta City', -6.1649, 107.0212),
        ])
      );

    const out = await geocodeCandidates('Grand Indonesia', null);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.name)).toEqual(['Grand Indonesia Shopping Town', 'Kantor Pemasaran Grand Duta City']);
  });

  test('an unknown place yields no candidates rather than a wrong one', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [] }) });

    expect(await geocodeCandidates('zzzz nowhere zzzz', null)).toEqual([]);
  });

  // A source returning *something* used to end the search, so a thin proxy reply
  // hid everything the other geocoders knew about.
  test('keeps asking further sources until the list is full', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          candidates: [{ name: 'Grand Indonesia Shopping Town', label: 'a', lat: -6.1958, lon: 106.8215 }],
        }),
      })
      .mockResolvedValueOnce(
        photon([feat('Grand Boutique Centre', -6.14, 106.84), feat('Grand Duta City', -6.1649, 107.0212)])
      );

    const out = await geocodeCandidates('Grand Indonesia', null, 5);
    expect(out.map((c) => c.name)).toEqual([
      'Grand Indonesia Shopping Town', // proxy first — its ranking stays on top
      'Grand Boutique Centre',
      'Grand Duta City',
    ]);
  });

  test('a place the first source already covers costs only one request', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          { name: 'A', label: 'a', lat: -6.1, lon: 106.1 },
          { name: 'B', label: 'b', lat: -6.2, lon: 106.2 },
        ],
      }),
    });

    expect(await geocodeCandidates('somewhere', null, 2)).toHaveLength(2);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // Distance clustering keeps these — they're kilometres apart — but two rows
  // reading identically give the user nothing to choose between.
  test('collapses entries whose label is identical, however far apart', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('backend down'))
      .mockResolvedValueOnce(
        photon([feat('Grand Orchard', -6.14, 106.86), feat('Grand Orchard', -6.21, 106.79)])
      );

    const out = await geocodeCandidates('Grand Orchard', null, 6);
    expect(out).toHaveLength(1);
  });

  test('deduping spans sources, so the same place from two geocoders appears once', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ candidates: [{ name: 'Monas', label: 'a', lat: -6.1754, lon: 106.8272 }] }),
      })
      .mockResolvedValueOnce(photon([feat('Monumen Nasional', -6.1755, 106.8273)]));

    const out = await geocodeCandidates('Monas', null, 6);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Monas');
  });
});
