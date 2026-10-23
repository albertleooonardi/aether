import { coordsFromMapsUrl, geocodeCandidates, photonSuggest, createSuggestTypeahead, pickIsCurrent } from './GeoService';

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

// Shared Photon response fixtures — used by both the full geocodeCandidates
// chain and the Photon-only suggestion path below.
const photon = (feats) => ({
  ok: true,
  json: async () => ({ features: feats }),
});
const feat = (name, lat, lon) => ({
  properties: { name, city: 'Jakarta', country: 'Indonesia' },
  geometry: { coordinates: [lon, lat] },
});

describe('geocodeCandidates', () => {
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

  // Each source gets its own signal (so one stall can't consume the others'
  // budget), and every fetch is bounded: 5s per source under a 12s overall cap.
  test('gives each source its own bounded signal', async () => {
    const original = AbortSignal.timeout;
    const timeout = jest.fn(() => new AbortController().signal);
    AbortSignal.timeout = timeout;
    try {
      global.fetch = jest.fn().mockRejectedValue(new Error('down'));
      await geocodeCandidates('nowhere', null);
      expect(global.fetch).toHaveBeenCalledTimes(4);
      expect(timeout).toHaveBeenCalledTimes(4);
      timeout.mock.calls.forEach(([ms]) => expect(ms).toBeLessThanOrEqual(5000));
      const signals = global.fetch.mock.calls.map(([, init]) => init.signal);
      expect(new Set(signals).size).toBe(4);
    } finally {
      AbortSignal.timeout = original;
    }
  });

  // The /api/geocode proxy is slow-but-healthy (~16s worst case server-side), so it
  // can exhaust its own budget; that must not stop direct Photon from answering.
  test('a first source that times out still lets a later source answer', async () => {
    const original = AbortSignal.timeout;
    // First signal is already spent (the proxy stalled); later ones are fresh.
    const spent = new AbortController();
    spent.abort();
    const timeout = jest.fn().mockReturnValueOnce(spent.signal).mockImplementation(() => new AbortController().signal);
    AbortSignal.timeout = timeout;
    try {
      global.fetch = jest
        .fn()
        .mockRejectedValueOnce(new DOMException('The operation timed out', 'TimeoutError'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ features: [{ properties: { name: 'Plaza Senayan' }, geometry: { coordinates: [106.8, -6.2] } }] }),
        });
      const out = await geocodeCandidates('Plaza Senayan', null);
      expect(global.fetch.mock.calls[1][0]).toMatch(/^https:\/\/photon\.komoot\.io\/api\?/);
      expect(out[0].name).toBe('Plaza Senayan');
    } finally {
      AbortSignal.timeout = original;
    }
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

describe('photonSuggest', () => {
  afterEach(() => jest.restoreAllMocks());

  test('shapes results the same way as geocodeCandidates, via fromPhoton', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(photon([feat('Pontianak', -0.0263, 109.3425)]));

    const out = await photonSuggest('pontianak', null);
    expect(out).toEqual([{ name: 'Pontianak', label: 'Pontianak, Jakarta, Indonesia', lat: -0.0263, lon: 109.3425 }]);
  });

  // The hard constraint: autocomplete-style querying is against Nominatim's
  // usage policy, so as-you-type must only ever reach Photon.
  test('calls Photon directly and nothing else', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(photon([]));

    await photonSuggest('pontianak', null);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toMatch(/^https:\/\/photon\.komoot\.io\/api\?/);
  });

  test('a doubtful leader asks Photon again for local names — still Photon only', async () => {
    // English names hide the one people type: "Kebun Raya Bogor" is displayed as
    // "Bogor Botanical Gardens", so a second ask for local ('default') names follows.
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(photon([feat('Kebun Raya Cibinong', -6.49, 106.85)]))
      .mockResolvedValueOnce(photon([feat('Kebun Raya Bogor', -6.5976, 106.7996)]));

    const out = await photonSuggest('Kebun Raya Bogor', null);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    for (const [url] of global.fetch.mock.calls) expect(url).toMatch(/^https:\/\/photon\.komoot\.io\/api\?/);
    expect(global.fetch.mock.calls[1][0]).toContain('lang=default');
    expect(out[0].name).toBe('Kebun Raya Bogor');
  });

  test('a failed request returns empty rather than throwing', async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(new Error('network down'));

    await expect(photonSuggest('pontianak', null)).resolves.toEqual([]);
  });

  test('an aborted request resolves quietly rather than throwing', async () => {
    global.fetch = jest.fn(
      (url, opts) =>
        new Promise((_, reject) => {
          opts.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          );
        })
    );
    const controller = new AbortController();
    const pending = photonSuggest('pontianak', null, controller.signal);
    controller.abort();

    await expect(pending).resolves.toEqual([]);
  });
});

describe('pickIsCurrent', () => {
  const pick = { text: 'Central Park, Jakarta Selatan', place: { name: 'Central Park', lat: -6.177, lon: 106.791 } };

  test('a stored pick is trusted while the field still reads exactly what it produced', () => {
    expect(pickIsCurrent(pick, 'Central Park, Jakarta Selatan')).toBe(true);
  });

  // Picking "Central Park, Jakarta Selatan" and then editing the text down to
  // plain "Central Park" must not silently keep routing to the picked pin —
  // that string alone could just as well mean a different Central Park.
  test('an edit after picking invalidates the pick', () => {
    expect(pickIsCurrent(pick, 'Central Park')).toBe(false);
  });

  test('no pick at all is never current', () => {
    expect(pickIsCurrent(null, 'Central Park, Jakarta Selatan')).toBe(false);
  });

  test('tolerates incidental surrounding whitespace in the field', () => {
    expect(pickIsCurrent(pick, '  Central Park, Jakarta Selatan  ')).toBe(true);
  });
});

describe('createSuggestTypeahead', () => {
  // Fake timers pause the debounce, but the awaited fetch chain inside it still
  // resolves on real microtasks — flush those explicitly after each advance.
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('does not fire below the 3-character minimum', () => {
    jest.useFakeTimers();
    global.fetch = jest.fn();
    const cb = jest.fn();

    createSuggestTypeahead().run('po', null, cb);
    jest.advanceTimersByTime(1000);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(cb).toHaveBeenCalledWith([]); // cleared immediately, not after the debounce
  });

  test.each([
    ['a Google Maps link', 'https://www.google.com/maps/place/Grand+Indonesia/@-6.1958,106.8215,17z'],
    ['a short link', 'https://maps.app.goo.gl/abc123'],
    ['a non-Google link', 'http://example.com/some/long/path'],
  ])('skips the geocoder for %s and clears any open list', (_, url) => {
    jest.useFakeTimers();
    global.fetch = jest.fn();
    const cb = jest.fn();

    createSuggestTypeahead().run(url, null, cb);
    jest.advanceTimersByTime(1000);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(cb).toHaveBeenCalledWith([]);
  });

  test('debounce collapses rapid keystrokes into a single request', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue(photon([]));
    const typeahead = createSuggestTypeahead();
    const cb = jest.fn();

    typeahead.run('pon', null, cb);
    jest.advanceTimersByTime(100);
    typeahead.run('pont', null, cb);
    jest.advanceTimersByTime(100);
    typeahead.run('ponti', null, cb);
    jest.advanceTimersByTime(300); // only now has 300ms of silence passed
    await flush();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain(encodeURIComponent('ponti'));
  });

  // The bug that makes naive typeahead feel broken: a slow response for an
  // earlier keystroke landing after a later, faster one and clobbering it.
  test('discards an out-of-order response in favour of the newer query', async () => {
    jest.useFakeTimers();
    const resolvers = [];
    global.fetch = jest.fn(() => new Promise((resolve) => resolvers.push(resolve)));
    const typeahead = createSuggestTypeahead();
    const cb = jest.fn();

    typeahead.run('pon', null, cb);
    jest.advanceTimersByTime(300);
    await flush();
    typeahead.run('pontianak', null, cb);
    jest.advanceTimersByTime(300);
    await flush();
    expect(resolvers).toHaveLength(2);

    // Newer query's response arrives first, the stale one straggles in after.
    resolvers[1](photon([feat('Pontianak', -0.02, 109.34)]));
    await flush();
    resolvers[0](photon([feat('Pondok Indah', -6.28, 106.78)]));
    await flush();

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith([expect.objectContaining({ name: 'Pontianak' })]);
  });

  test('aborts the in-flight request the instant a newer query supersedes it', async () => {
    jest.useFakeTimers();
    const signals = [];
    global.fetch = jest.fn((url, opts) => {
      signals.push(opts.signal);
      return new Promise(() => {}); // never settles — only the abort matters here
    });
    const typeahead = createSuggestTypeahead();

    typeahead.run('pon', null, jest.fn());
    jest.advanceTimersByTime(300);
    await flush();
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    typeahead.run('pontianak', null, jest.fn());
    expect(signals[0].aborted).toBe(true); // aborted before the new debounce even elapses
  });

  test('cancel() silences a response already in flight', async () => {
    jest.useFakeTimers();
    let resolveFetch;
    global.fetch = jest.fn(() => new Promise((resolve) => (resolveFetch = resolve)));
    const typeahead = createSuggestTypeahead();
    const cb = jest.fn();

    typeahead.run('pontianak', null, cb);
    jest.advanceTimersByTime(300);
    await flush();
    typeahead.cancel(); // e.g. a place was just selected, or the input was cleared

    resolveFetch(photon([feat('Pontianak', -0.02, 109.34)]));
    await flush();

    expect(cb).not.toHaveBeenCalled();
  });
});
