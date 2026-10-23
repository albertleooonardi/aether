import { rankPlaces, needsMore, coversQuery, looserQuery, nominatimLabel } from './placeRank';

// Every case below is a real search whose first result disagreed with Google
// Maps' first result, using the candidates the OSM geocoders actually returned.
const NEAR = { lat: -6.2, lon: 106.63 }; // Tangerang
const top = (q, list, opts) => rankPlaces(q, list, NEAR, opts)[0]?.name;

describe('rankPlaces puts first what Google puts first', () => {
  test('a mall beats its own parking lots', () => {
    const list = [
      { name: 'Aeon Mall Alternative Parking Area', kind: 'amenity=motorcycle_parking', lat: -6.303, lon: 106.6423 },
      { name: 'Aeon Mall Alternative Parking Area', kind: 'amenity=parking', lat: -6.3025, lon: 106.644 },
      { name: 'ÆON Mall', kind: 'shop=mall', lat: -6.3044, lon: 106.6442 },
    ];
    expect(top('AEON Mall BSD', list)).toBe('ÆON Mall');
  });

  test('a landmark area beats a same-named residential street', () => {
    const list = [
      { name: 'MONAS', kind: 'highway=living_street', label: 'MONAS, Bekasi', lat: -6.2349, lon: 107.0124 },
      { name: 'Monas Park', kind: 'leisure=park', label: 'Monas Park, Jakarta', lat: -6.1767, lon: 106.8265 },
      { name: 'Monash University, Indonesia', kind: 'amenity=university', lat: -6.3025, lon: 106.6519 },
    ];
    expect(top('Monas', list)).toBe('Monas Park');
  });

  test('a word-less fuzzy match is never a result ("Ciater Udik" is not Cisterna, Italy)', () => {
    const list = [
      { name: 'Cisterna', kind: 'place=village', label: 'Cisterna, Coseano, Italy', lat: 46.0852, lon: 12.9896 },
      { name: 'Via Cisterna', kind: 'highway=residential', label: 'Via Cisterna, Italy', lat: 46.1, lon: 13.0 },
    ];
    expect(rankPlaces('Ciater Udik', list, NEAR)).toEqual([]);
  });

  test('the exact name beats a longer one that merely contains the words', () => {
    const list = [
      { name: 'Universitas Insan Pembangunan Indonesia', kind: 'amenity=university', lat: -6.2, lon: 106.6 },
      { name: 'Universitas Indonesia', kind: 'amenity=university', lat: -6.3606, lon: 106.8272 },
    ];
    expect(top('Universitas Indonesia', list)).toBe('Universitas Indonesia');
  });

  test('a kind word in the name doesn\'t cost it the exact match, and a far mall loses', () => {
    const list = [
      { name: 'Pacific Place', kind: 'shop=mall', label: 'Pacific Place, Seattle, United States', lat: 47.61, lon: -122.34 },
      { name: 'Pacific Place Mall', kind: 'shop=mall', label: 'Pacific Place Mall, Jakarta', lat: -6.2246, lon: 106.81 },
    ];
    expect(top('Pacific Place', list)).toBe('Pacific Place Mall');
  });

  test('initials match: ICE is Indonesia Convention Exhibition', () => {
    const list = [
      { name: 'Salt by ICE', kind: 'amenity=restaurant', lat: -6.3004, lon: 106.6364 },
      { name: 'Indonesia Convention Exhibition', kind: 'building=yes', lat: -6.3006, lon: 106.6366 },
    ];
    expect(top('ICE BSD', list)).toBe('Indonesia Convention Exhibition');
  });

  test('"RS" means hospital, and a loosened search prefers the nearby one', () => {
    const list = [
      { name: 'RS SILOAM ASRI', kind: 'amenity=hospital', lat: -6.24, lon: 106.84 },
      { name: 'Siloam Hospital', kind: 'amenity=hospital', area: 'Lippo Village', lat: -6.225, lon: 106.598 },
    ];
    expect(top('RS Siloam Karawaci', list, { nearWeight: 1.2 })).toBe('Siloam Hospital');
  });

  test('the name exactly as typed beats one that matches only without its kind word', () => {
    const list = [
      { name: 'RSU Pantai Indah Kapuk', kind: 'amenity=hospital', lat: -6.11, lon: 106.75 },
      { name: 'Pantai Indah Kapuk', kind: 'place=suburb', lat: -6.1091, lon: 106.74 },
    ];
    expect(top('Pantai Indah Kapuk', list)).toBe('Pantai Indah Kapuk');
  });

  test('a street wins when a street was asked for', () => {
    const list = [
      { name: 'Sudirman Park', kind: 'leisure=park', lat: -6.21, lon: 106.82 },
      { name: 'Jalan Jenderal Sudirman', kind: 'highway=primary', lat: -6.211, lon: 106.816 },
    ];
    expect(top('Jalan Sudirman Jakarta', list)).toBe('Jalan Jenderal Sudirman');
  });
});

describe('when to ask the second source', () => {
  test('a leader missing a typed word from its name', () => {
    const ranked = [{ name: 'Kebun Raya Cibinong', kind: 'leisure=garden', label: 'Kebun Raya Cibinong, Bogor', lat: -6.49, lon: 106.85 }];
    expect(coversQuery('Kebun Raya Bogor', ranked[0])).toBe(false);
    expect(needsMore('Kebun Raya Bogor', ranked, NEAR)).toBe(true);
  });

  test('a small place on another continent ("Dufan" is a nickname)', () => {
    const ranked = [{ name: 'Dúfan Apartments', kind: 'building=apartments', lat: 41.0, lon: 29.0 }];
    expect(needsMore('Dufan', ranked, NEAR)).toBe(true);
  });

  test('not when the leader is a clean, nearby, exact answer', () => {
    const ranked = [{ name: 'Summarecon Mall Serpong', kind: 'shop=mall', lat: -6.2411, lon: 106.6283 }];
    expect(needsMore('Summarecon Mall Serpong', ranked, NEAR)).toBe(false);
  });
});

describe('looserQuery drops the words no candidate knows', () => {
  test('"Ciater Udik" → "Ciater"', () => {
    expect(looserQuery('Ciater Udik', [{ name: 'Ciater', label: 'Ciater, Serpong' }])).toBe('Ciater');
  });
  test('nothing matched at all → the first specific word', () => {
    expect(looserQuery('Ciater Udik', [{ name: 'Cisterna', label: 'Cisterna, Italy' }])).toBe('Ciater');
  });
  test('every word known → no looser query', () => {
    expect(looserQuery('Plaza Senayan', [{ name: 'Plaza Senayan' }])).toBeNull();
  });
});

describe('nominatimLabel reads like an address, not a house number', () => {
  test('the city, not the sub-area or the street number', () => {
    expect(
      nominatimLabel('Dunia Fantasi, Pantai Indah, Kawasan Wisata Ancol, Ancol, Pademangan, Jakarta Utara, Daerah Khusus ibukota Jakarta, 14430, Indonesia')
    ).toBe('Dunia Fantasi, Jakarta Utara');
    expect(
      nominatimLabel('Indonesia Convention Exhibition, 1, Jalan BSD Grand Boulevard, Pagedangan, Kabupaten Tangerang, Banten, 15339, Indonesia')
    ).toBe('Indonesia Convention Exhibition, Kabupaten Tangerang');
  });
  test('RT/RW and postcodes are skipped', () => {
    expect(nominatimLabel('Ciater, RW 010, Serpong, Tangerang Selatan, Banten, 15310, Indonesia')).toBe('Ciater, Tangerang Selatan');
  });
  test('short addresses pass through', () => {
    expect(nominatimLabel('Bandung, Indonesia')).toBe('Bandung, Indonesia');
  });
});
