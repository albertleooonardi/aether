// Deterministic intent parsing for the chat. These decide which async handler
// (weather-in-a-place, or route-with-rain) a message triggers.
import { parseWhen } from './assistant';

const isHere = (s) => /^(my (place|location|home|area|position)|here|me|current location)$/i.test(s.trim());

// People write "into"/"towards" as often as "to" ("analyze my route from my place
// into Maspion Plaza"), and \bto\b never matches inside "into" — so those phrasings
// used to miss the parser entirely and fall through to a generic reply.
// Longest alternative first so "to" can't shadow "towards".
const TO = '(?:into|towards|toward|to)';

// A dash introduces the question as often as a comma does — the app's own
// suggestion chip reads "… to Grand Indonesia — will it rain?". Without the dash
// as a terminator the geocoder received "Grand Indonesia —", which ranks an
// estate agent's office 27km away above the mall. Terminators are punctuation,
// or a spaced dash, or end-of-string.
const STOP = '(?:[?.,;:!]|\\s+[—–-]\\s*|$)';

// "navigate to Jl. Tunjungan No. 1" — in this app's locale a dot after a 1–3
// letter token is an abbreviation (Jalan, Nomor, Dr., St.), not the end of a
// sentence, but STOP treats every dot as a clause terminator and truncated the
// destination to "Jl". Right-hand context can't tell the two apart ("Jl. T…" and
// "Bandung. T…" look identical), so mask those dots while the clause is sliced
// and put them back afterwards. The sentinel is one char wide, so string offsets
// (navAt) stay valid, and a plain replace can't backtrack.
const ABBREV_DOT = '\u0000';
const maskAbbrev = (s) => s.replace(/\b([A-Za-z]{1,3})\.(?=\s|$)/g, `$1${ABBREV_DOT}`);
const unmaskAbbrev = (s) => s.split(ABBREV_DOT).join('.');

// Strip anything left dangling by the clause trim (trailing dashes, commas).
const tidy = (s) => s.replace(/[\s,;:—–-]+$/, '').trim();

// "route to X at 6pm" — the time is the departure, not part of the place name, so
// it has to come off before the destination is geocoded.
const TIME_TAIL = /\s+(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|in\s+\d+\s*(?:minutes?|mins?|hours?|hrs?|h))\b.*$/i;

export const parseMapsUrl = (text) => (text.match(/https?:\/\/\S+/i) || [null])[0];

// Verbs that follow future-tense "going to" — never a destination.
const NOT_A_PLACE =
  /^(?:be|get|feel|stay|become|start|stop|clear|cool|warm|heat|do|have|make|take|see|look|last|end|change|snow|pour|drizzle)\b/i;

// Words that mark a message as asking for a way somewhere. "going to X" counts:
// "is there any rain later when I'm going to Maspion Plaza" is a route question
// — the rain that matters is along the way, at travel time — but with only
// route/directions/drive here it matched nothing and fell through to a generic
// current-city rain reply.
// Every verb needs its inflections spelled out, because NAV is always used inside
// \b…\b: a bare "commute"/"travel" can never match "commuting"/"travelling", so
// those phrasings hit the same fall-through bug "going to" was fixed for. The
// doubled l is optional (travell?) to cover both the British and American spelling.
const NAV =
  '(?:routes?|directions?|navigate|navigation|driving|drive|commut(?:ing|es?)|travell?(?:ing|s|ed)?|head(?:ing|ed)?|way|go(?:ing|nna)?|omw|on my way|visit(?:ing)?|leaving)';

// "route from X to Y", "directions to Y", "check the route for going to Y",
// or any of those pointed at a pasted Google Maps link.
export const parseNavigation = (text) => {
  const t = text.toLowerCase();
  // A URL is the destination verbatim — it must skip the sentence parsing below,
  // whose terminators (. ? :) would slice it apart at the first dot.
  const url = parseMapsUrl(text);

  const navAt = t.search(new RegExp(`\\b${NAV}\\b`));
  // "visiting Kota Tua" names its destination with no "to" at all.
  const VISIT = /\bvisit(?:ing)?\s+([A-Za-z].*)/i;
  const hasNav =
    (/\bfrom\b/.test(t) && new RegExp(`\\b${TO}\\b`).test(t)) ||
    (navAt >= 0 && new RegExp(`\\b${NAV}\\b.*\\b${TO}\\b`).test(t)) ||
    VISIT.test(t) ||
    t.includes('best route');
  if (!hasNav) return null;

  let originText = null;
  let destText = null;

  if (url) {
    const om = text.match(new RegExp(`from\\s+(.+?)\\s+${TO}\\s+https?://`, 'i'));
    if (om) originText = tidy(om[1]);
    destText = url;
  } else {
    const src = maskAbbrev(text);
    let m = src.match(new RegExp(`from\\s+(.+?)\\s+${TO}\\s+(.+?)${STOP}`, 'i'));
    if (m) {
      originText = m[1].trim();
      destText = m[2].trim();
    } else if (navAt >= 0) {
      // English puts filler between the nav word and the destination — "check the
      // route **for going** to X", "the way **round** to X". Demanding that "to"
      // follow the nav word immediately recognised those as navigation and then
      // silently dropped them, so take the first "to …" after the nav word.
      m = src.slice(navAt).match(new RegExp(`\\b${TO}\\s+(.+?)${STOP}`, 'i'));
      if (m) destText = m[1].trim();
    }
    if (!destText) {
      m = src.match(new RegExp(`\\bvisit(?:ing)?\\s+(.+?)${STOP}`, 'i'));
      if (m) destText = m[1].trim();
    }
    if (!destText) return null;
    destText = unmaskAbbrev(destText);
    if (originText) originText = unmaskAbbrev(originText);

    // Trim trailing question clauses that slip past the punctuation.
    destText = tidy(destText.replace(/\s+(is|are|will|does|do|can|and|when|any|if|should)\b.*$/i, ''));
    destText = tidy(destText.replace(TIME_TAIL, ''));
    // "go to Bandung tomorrow" — the day is when, not part of where.
    destText = tidy(destText.replace(/\s+(today|tonight|tomorrow|later|now|right now|please)$/i, ''));
    if (originText) originText = tidy(originText.replace(/\s+(is|are|will|does|do|can|and|when|any|if)\b.*$/i, ''));

    // "going to" is also plain future tense — "is it going to rain", "going to
    // be hot today". If what follows "to" is weather or a bare verb, nobody is
    // travelling anywhere, so this is not navigation.
    if (destText && (WEATHER_WORD.test(destText) || NOT_A_PLACE.test(destText))) return null;
  }
  if (!destText) return null;

  return {
    originText: originText && !isHere(originText) ? originText : null, // null → use current location
    destText,
    isUrl: !!url,
    departAt: parseWhen(text), // null → leaving now
    asksRain: /\brain|wet|umbrella|storm|shower/.test(t),
  };
};

// Prepositions that can introduce a place. "of" belongs here — "the temp of
// Pontianak" is ordinary phrasing — but it also shows up in "chance of rain",
// where the following word is weather, not somewhere you can stand.
const PLACE_PREP = '(?:in|at|for|of|around|near)';
const WEATHER_WORD =
  /^(?:rain|rains|raining|snow|wind|sun|sunshine|showers?|storms?|thunder|humidity|temperature|temp|weather|forecast|uv|clouds?|fog|haze|smog)\b/i;

// Bare time words that a follow-up can consist of, and that a preposition can
// point at instead of a place — neither is geocodable.
const TIME_WORD = /^(?:today|tonight|tomorrow|later|now|then|this (?:morning|afternoon|evening)|the morning|the afternoon|the evening)$/i;

// A place name ends where the next clause begins. The capture below runs to the
// next punctuation mark, and English puts no comma before these — so "will it
// rain in Bandung on my way home" handed the whole tail to the geocoder. Same
// idea as the STOP terminator parseNavigation already uses.
const CLAUSE_TAIL = /\s+(?:on (?:my|the|our|your) way|when|while|before|after|if)\b.*$/i;

// One candidate place: the text following a preposition, up to the next
// punctuation mark or trailing clause. Returns null when it isn't a place.
const placeCandidate = (rest) => {
  const place = rest.match(/^[^?.,;]*/)[0].replace(CLAUSE_TAIL, '').trim();
  if (!place) return null;
  // "chance of rain in Pontianak" — this preposition points at the weather word,
  // not the place. Drop it and look again in what's left.
  if (WEATHER_WORD.test(place)) return placeAfter(place.replace(WEATHER_WORD, ''));
  if (isHere(place)) return null; // current-location questions are handled elsewhere
  // "forecast for tomorrow" is a time, not a place. The trailing-time-word strip
  // below only fires on a time word that FOLLOWS a place (it needs the leading
  // \s+), so when the whole capture IS the time word it survived and "tomorrow"
  // went to the geocoder.
  if (TIME_WORD.test(place)) return null;

  return place.replace(/\s+(today|now|right now|tomorrow|please|rn|currently)$/i, '').trim() || null;
};

const placeAfter = (text) => {
  // Collect where each preposition's place could start. The lookahead is what
  // makes this a scan: a capturing `[^?.,;]*` would swallow the rest of the
  // string on the first match, hiding every later preposition from the search.
  const prep = new RegExp(`\\b${PLACE_PREP}\\s+(?=[A-Za-z])`, 'gi');
  const starts = [];
  for (let m = prep.exec(text); m; m = prep.exec(text)) starts.push(m.index + m[0].length);

  // Last preposition first: "is the weather good for running in Bandung" has
  // filler after the first one, and only the last points at somewhere you can
  // stand. Earlier ones stay in play as a fallback, so a last candidate that is
  // a time word or "my area" doesn't lose an earlier real place.
  for (let i = starts.length - 1; i >= 0; i--) {
    const hit = placeCandidate(text.slice(starts[i]));
    if (hit) return hit;
  }
  return null;
};

// "weather in Surabaya", "will it rain in Tokyo", "what is the temp of Pontianak"
export const parseWeatherIn = (text) => {
  const t = text.toLowerCase();
  // \bhumid\b never matches "humidity", so "humidity of Pontianak" used to fall
  // through and get answered with the current city's number. Match inflections.
  if (
    !/\b(weather|forecast|temperature|temp|rain(?:ing|y)?|hot|cold|warm|humid(?:ity)?|wind(?:y)?|sun(?:ny)?|uv|dew ?point|pressure|visibility|aqi|air quality|snow(?:ing)?|storm(?:s|y)?|climate|conditions?)\b/.test(
      t
    )
  ) {
    return null;
  }
  return placeAfter(text);
};

// "What about Central Park?", "how about at 8pm", "and Bandung?" — follow-ups
// that only make sense against the previous question. Returns what changed:
// { place } (a new destination for the same question) or { departAt } (a new
// time for the same trip), or null when the message stands on its own.
export const parseFollowUp = (text) => {
  const m = text.trim().match(/^(?:(?:and\s+)?(?:what|how)\s+about|and)\s+(.+?)[?.!\s]*$/i);
  if (!m) return null;
  const rest = tidy(m[1]);

  // "how about at 8pm" / "what about in 2 hours" — same trip, different time.
  if (/^(?:leaving\s+|departing\s+)?(?:at|in)\b/i.test(rest)) {
    const departAt = parseWhen(rest);
    return departAt ? { departAt } : null;
  }

  // "and will it rain?" continues the sentence, it doesn't name a place.
  if (/^(?:it|is|are|will|does|do|can|should|when|if)\b/i.test(rest)) return null;
  const core = rest.replace(/^the\s+/i, ''); // "what about the rain" asks about rain, not a place
  if (isHere(rest) || WEATHER_WORD.test(core) || TIME_WORD.test(core) || NOT_A_PLACE.test(rest)) return null;

  // "what about Central Park, will it rain?" — keep the place, drop the clause.
  const place = tidy(rest.replace(/\s+(is|are|will|does|do|can|and|when|any|if|should)\b.*$/i, '').replace(TIME_TAIL, ''));
  return place ? { place, departAt: parseWhen(text) } : null;
};
