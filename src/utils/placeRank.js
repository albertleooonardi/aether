/*
 * Ranking for place search, shared by the browser (src/services/GeoService.js)
 * and the server (api/_lib/core.js) — CommonJS so both can load it.
 *
 * The OSM geocoders return the right place, but not always first: measured
 * against Google Maps for the same searches, "Monas" put a residential street in
 * Bekasi above the National Monument, "AEON Mall BSD" put two parking lots above
 * the mall, and "Ciater Udik" (a name OSM doesn't have) came back as Cisterna,
 * Italy — a fuzzy match sharing no word with the query. Google ranks by how well
 * the NAME matches and how prominent the place is, with distance as a tiebreak.
 * This does the same with what OSM tells us.
 */

// Lower-case, accents off, "Æ" → "ae", so "ÆON Mall" matches "aeon mall".
const fold = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const words = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);

// Words that describe the kind of place rather than name it ("RS" = hospital,
// "Jl" = street). They still count when present, but a candidate isn't punished
// for spelling them differently ("Rumah Sakit" vs "RS").
const GENERIC = new Set([
  'jl', 'jln', 'jalan', 'street', 'st', 'road', 'rd', 'rs', 'rsu', 'rsud', 'rumah', 'sakit', 'hospital',
  'stasiun', 'station', 'mall', 'plaza', 'universitas', 'university', 'univ', 'kota', 'city', 'kab',
  'kabupaten', 'kecamatan', 'kelurahan', 'desa', 'the', 'of', 'di', 'dan', 'and',
]);

// What a kind of place is called in a query, so "RS Siloam" credits a place
// named "Siloam Hospital", and "Stasiun Rawa Buntu" one named "Rawa Buntu".
const KIND_WORDS = [
  [/^amenity=(hospital|clinic)$/, ['rs', 'rsu', 'rsud', 'rumah', 'sakit', 'hospital', 'klinik']],
  [/^(railway=(station|halt)|public_transport=station|building=train_station)$/, ['stasiun', 'station', 'st']],
  [/^shop=(mall|department_store)$/, ['mall', 'plaza']],
  [/^amenity=(university|college)$/, ['universitas', 'university', 'univ', 'kampus']],
  [/^highway=/, ['jl', 'jln', 'jalan', 'street', 'st', 'road', 'rd']],
  [/^aeroway=/, ['bandara', 'airport']],
];
const kindWords = (kind) => (kind ? KIND_WORDS.filter(([re]) => re.test(kind)).flatMap(([, w]) => w) : []);

const STREET_QUERY = /\b(jl|jln|jalan|street|st|road|rd|gang|gg)\b/;

// How much a kind of place tends to be what a searcher means. Keys are OSM
// `key=value` (Photon) or `class=type` (Nominatim).
const PROMINENT = [
  [/^aeroway=(aerodrome|terminal)$/, 2],
  [/^(tourism=(attraction|museum|zoo|theme_park|viewpoint)|historic=)/, 2],
  [/^place=(city|town)$/, 1.8],
  [/^(railway=station|public_transport=station|amenity=bus_station|building=train_station)$/, 1.5],
  [/^(shop=(mall|department_store)|amenity=(university|college|hospital|marketplace|exhibition_centre|conference_centre))$/, 1.5],
  [/^(leisure=(park|stadium|sports_centre|garden)|amenity=(place_of_worship|townhall))$/, 1.2],
  [/^(place=(suburb|village|neighbourhood|quarter|hamlet|district|municipality|borough)|boundary=administrative)$/, 1.2],
  [/^(amenity=(school|clinic|cinema|theatre)|tourism=hotel|building=(commercial|retail))$/, 0.6],
];
const MINOR = [
  [/^amenity=(parking|motorcycle_parking|bicycle_parking|parking_entrance|parking_space|atm|toilets|vending_machine)$/, -2.5],
  [/^(entrance=|highway=(bus_stop|platform)|railway=(stop|platform)|public_transport=(platform|stop_position))/, -1.2],
  [/^waterway=/, -1.5],
  [/^highway=(living_street|service|footway|path|track|steps|pedestrian|residential|unclassified|cycleway)$/, -1.2],
  [/^(office|craft)=/, -0.8],
];
// Sub-features named after their parent ("AEON Mall Parking", "Gerbang UI").
const PART_WORDS = /\b(parking|parkir|entrance|exit|gate|gerbang|pintu|lobby|drop ?off|loket|toilet|atm|halte|alternative)\b/;

const kindWeight = (kind, streetQuery) => {
  if (!kind) return 0;
  if (streetQuery && /^highway=/.test(kind)) return 1; // asked for a street: streets are right
  for (const [re, w] of PROMINENT) if (re.test(kind)) return w;
  for (const [re, w] of MINOR) if (re.test(kind)) return w;
  return 0;
};

const FAR_KM = 500;

const km = (a, b) => {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.sin(((b.lon - a.lon) * r) / 2) ** 2 * Math.cos(a.lat * r) * Math.cos(b.lat * r);
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

// How strongly a query word appears in a place: 1 for the whole word, 0.75 when
// one is a prefix of the other ("tangcity" ~ "tang", "bsd" ~ "bsdcity"). Partial
// credit keeps "Monas" from ranking Monash University level with Monas Park.
const strength = (q, pool) => {
  if (pool.includes(q)) return 1;
  return pool.some((w) => (q.length >= 3 && w.startsWith(q)) || (w.length >= 4 && q.startsWith(w))) ? 0.75 : 0;
};
// Generic words ("Universitas", "Stasiun") count, but less than the words that
// actually name the place.
const weightOf = (w) => (GENERIC.has(w) ? 0.4 : 1);
const coverage = (asked, pool) => {
  const total = asked.reduce((t, w) => t + weightOf(w), 0);
  return asked.reduce((sum, w) => sum + weightOf(w) * strength(w, pool), 0) / total;
};
const hit = (q, pool) => strength(q, pool) > 0;

/*
 * How well a candidate answers the query. Candidates carry { name, label, lat,
 * lon } plus optional `kind` ("shop=mall") and `importance` (0–1, Nominatim).
 * Returns null when it shares no meaningful word with the query: those are the
 * engine's fuzzy guesses ("Ciater Udik" → Cisterna), never what was meant.
 */
const scorePlace = (query, c, near, nearWeight = 0.35) => {
  const asked = words(query);
  if (!asked.length) return 0;
  // Initials count as a word of the name: "ICE" is Indonesia Convention
  // Exhibition, "UI" Universitas Indonesia, "GBK" Gelora Bung Karno.
  const own = words(c.name);
  const initials = own.length >= 2 ? [own.map((w) => w[0]).join('')] : [];
  const nameW = own.concat(kindWords(c.kind), initials);
  const allW = nameW.concat(words(c.label), words(c.area));
  // Only the specific words decide whether this is a guess at all. Nominatim
  // matches alternative names too ("Monas" → "Monumen Nasional"), so its results
  // are an alias match, not a fuzzy guess; Photon's word-less hits are guesses.
  const specific = asked.filter((w) => !GENERIC.has(w));
  const noWord = (specific.length ? specific : asked).every((w) => !hit(w, allW));
  if (noWord && !c.alias) return null;
  const inName = noWord ? 0.9 : coverage(asked, nameW);
  const inAll = noWord ? 0.9 : coverage(asked, allW);
  const streetQuery = STREET_QUERY.test(fold(query));
  const kindW = kindWeight(c.kind, streetQuery);

  let s = 4 * inName + 2 * inAll;
  if (inAll === 1) s += 1; // every word, whole
  // The name IS the query ("Universitas Indonesia"): what Google puts first —
  // for a destination, not a same-named side street or bus stop.
  // Words that only restate the kind ("Mall" on a mall, "RS"/"Hospital" on a
  // hospital) don't make a name more or less exact: "Pacific Place Mall" IS the
  // "Pacific Place" a searcher means.
  const kindSet = new Set(kindWords(c.kind));
  const core = (list) => list.filter((w) => !GENERIC.has(w) && !kindSet.has(w)).join(' ');
  // Exactly as typed beats exact once a kind word is set aside: "Pantai Indah
  // Kapuk" is the district before "RSU Pantai Indah Kapuk", the hospital.
  if (kindW >= 0 && own.join(' ') === asked.join(' ')) s += 3;
  else if (kindW >= 0 && core(own) && core(own) === core(asked)) s += 2.4;
  // Words in the name nobody typed — "Universitas Insan Pembangunan Indonesia" for
  // "Universitas Indonesia", "Kebun Raya Cibinong" for "Kebun Raya Bogor". Not for
  // an alias match, whose name is by definition different from what was typed.
  // Words spelled out by a typed acronym aren't extra ("ICE" → all three words
  // of "Indonesia Convention Exhibition").
  const byInitials = initials.length && asked.includes(initials[0]);
  if (!noWord && !byInitials) s -= 0.3 * Math.min(3, own.filter((w) => !kindSet.has(w) && !hit(w, asked)).length);
  s += kindW;
  if (PART_WORDS.test(fold(c.name)) && !PART_WORDS.test(fold(query))) s -= 2;
  // Nominatim's importance is the prominence signal Google leans on. Only
  // Nominatim has it, so only what sets a place apart counts — the ~0.2 every
  // ordinary named place gets would otherwise outrank a nearer Photon result.
  if (Number.isFinite(c.importance)) s += 3 * Math.max(0, c.importance - 0.2);
  // Nearby breaks ties without letting a backstreet beat a landmark across town.
  if (near && Number.isFinite(near.lat)) {
    const d = km(near, c);
    s -= nearWeight * Math.log10(1 + d);
    // A small place in another region is almost never what was meant when a
    // same-named one exists nearby ("Monas" is not the village in Sulawesi).
    // Cities, airports and landmarks travel; villages, streets and malls don't
    // ("Pacific Place" is Jakarta's mall, not Seattle's).
    if (d > FAR_KM && kindWeight(c.kind, false) < 1.8) s -= 3;
  }
  return s;
};

// `nearWeight` rises for a loosened query: when a word had to be dropped
// ("Ciater Udik" → "Ciater"), it was usually a local qualifier, so of the
// places sharing the remaining name the nearby one is the likelier meaning.
const rankPlaces = (query, list, near, { nearWeight } = {}) =>
  (list || [])
    .map((c, i) => ({ c, i, s: scorePlace(query, c, near, nearWeight) }))
    .filter((x) => x.s !== null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);

// Does the best candidate's NAME carry every specific word typed? When it
// doesn't ("Kebun Raya Cibinong, Bogor" for "Kebun Raya Bogor" — Bogor is only in
// its address), a second source (or a looser query) is worth asking.
const coversQuery = (query, c) => {
  if (!c) return false;
  const asked = words(query).filter((w) => !GENERIC.has(w));
  const pool = words(c.name);
  return asked.every((w) => hit(w, pool));
};

// Worth asking the second source? When the leader's name misses a typed word,
// or the leader is a minor thing (a side street, a bus stop) for a query that
// wasn't asking for one — the landmark may only be known by an alias.
// Also when the leader is a small place far away ("Dufan" → apartments abroad;
// the theme park is only known by that nickname), or when the top two are a
// near-tie in different places — then the second source's prominence decides.
const needsMore = (query, ranked, near) => {
  const top = ranked && ranked[0];
  if (!coversQuery(query, top)) return true;
  const weight = kindWeight(top.kind, STREET_QUERY.test(fold(query)));
  if (weight < 0) return true;
  if (near && Number.isFinite(near.lat) && km(near, top) > FAR_KM && weight < 1.8) return true;
  const next = ranked[1];
  if (next && km(top, next) > 5) {
    const a = scorePlace(query, top, near);
    const b = scorePlace(query, next, near);
    if (a !== null && b !== null && a - b < 0.75) return true;
  }
  return false;
};

// "Ciater Udik" → "Ciater": the query minus words no candidate knows, for one
// retry when nothing matched every word. Null when there's nothing to drop.
const looserQuery = (query, list) => {
  const pool = (list || []).flatMap((c) => words(c.name).concat(words(c.label), words(c.area)));
  const all = String(query).trim().split(/\s+/);
  // Keep only the words that name something the engine knows; generic ones
  // ("RS") narrow a search to places that happen to spell them out.
  const kept = all.filter((w) => {
    const f = fold(w).replace(/[^a-z0-9]/g, '');
    return f && !GENERIC.has(f) && hit(f, pool);
  });
  const specificCount = all.filter((w) => {
    const f = fold(w).replace(/[^a-z0-9]/g, '');
    return f && !GENERIC.has(f);
  }).length;
  if (kept.length === specificCount) return null; // every naming word is known
  if (!kept.length) {
    // Nothing matched at all: try the first specific word on its own.
    const first = all.find((w) => !GENERIC.has(fold(w).replace(/[^a-z0-9]/g, '')));
    return all.length > 1 && first ? first : null;
  }
  return kept.join(' ');
};

// A readable subtitle from Nominatim's full address — "Dunia Fantasi, Jakarta
// Utara", not "Dunia Fantasi, Miniatur Lapangan Fatahillah" or "Indonesia
// Convention Exhibition, 1" (the first two parts, which are often a house
// number or a sub-area). Postcodes, numbers and RT/RW are skipped; the city sits
// third from the end once those are gone (…, city, province, country).
const nominatimLabel = (displayName) => {
  const parts = String(displayName || '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x && !/^\d[\d\s-]*$/.test(x) && !/^(rt|rw)\b/i.test(x));
  if (parts.length <= 2) return parts.join(', ');
  const city = parts[Math.max(1, parts.length - 3)];
  return city === parts[0] ? `${parts[0]}, ${parts[parts.length - 1]}` : `${parts[0]}, ${city}`;
};

module.exports = { rankPlaces, scorePlace, coversQuery, needsMore, looserQuery, nominatimLabel, fold };
