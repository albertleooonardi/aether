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

// Strip anything left dangling by the clause trim (trailing dashes, commas).
const tidy = (s) => s.replace(/[\s,;:—–-]+$/, '').trim();

// "route to X at 6pm" — the time is the departure, not part of the place name, so
// it has to come off before the destination is geocoded.
const TIME_TAIL = /\s+(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|in\s+\d+\s*(?:minutes?|mins?|hours?|hrs?|h))\b.*$/i;

export const parseMapsUrl = (text) => (text.match(/https?:\/\/\S+/i) || [null])[0];

// Words that mark a message as asking for a way somewhere.
const NAV = '(?:routes?|directions?|navigate|navigation|driving|drive|commute|travel|head|way)';

// "route from X to Y", "directions to Y", "check the route for going to Y",
// or any of those pointed at a pasted Google Maps link.
export const parseNavigation = (text) => {
  const t = text.toLowerCase();
  // A URL is the destination verbatim — it must skip the sentence parsing below,
  // whose terminators (. ? :) would slice it apart at the first dot.
  const url = parseMapsUrl(text);

  const navAt = t.search(new RegExp(`\\b${NAV}\\b`));
  const hasNav =
    (/\bfrom\b/.test(t) && new RegExp(`\\b${TO}\\b`).test(t)) ||
    (navAt >= 0 && new RegExp(`\\b${NAV}\\b.*\\b${TO}\\b`).test(t)) ||
    t.includes('best route');
  if (!hasNav) return null;

  let originText = null;
  let destText = null;

  if (url) {
    const om = text.match(new RegExp(`from\\s+(.+?)\\s+${TO}\\s+https?://`, 'i'));
    if (om) originText = tidy(om[1]);
    destText = url;
  } else {
    let m = text.match(new RegExp(`from\\s+(.+?)\\s+${TO}\\s+(.+?)${STOP}`, 'i'));
    if (m) {
      originText = m[1].trim();
      destText = m[2].trim();
    } else if (navAt >= 0) {
      // English puts filler between the nav word and the destination — "check the
      // route **for going** to X", "the way **round** to X". Demanding that "to"
      // follow the nav word immediately recognised those as navigation and then
      // silently dropped them, so take the first "to …" after the nav word.
      m = text.slice(navAt).match(new RegExp(`\\b${TO}\\s+(.+?)${STOP}`, 'i'));
      if (m) destText = m[1].trim();
    }
    if (!destText) return null;

    // Trim trailing question clauses that slip past the punctuation.
    destText = tidy(destText.replace(/\s+(is|are|will|does|do|can|and|when|any|if|should)\b.*$/i, ''));
    destText = tidy(destText.replace(TIME_TAIL, ''));
    if (originText) originText = tidy(originText.replace(/\s+(is|are|will|does|do|can|and|when|any|if)\b.*$/i, ''));
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

const placeAfter = (text) => {
  const m = text.match(new RegExp(`\\b${PLACE_PREP}\\s+([A-Za-z][^?.,;]*)`, 'i'));
  if (!m) return null;

  const place = m[1].trim();
  // "chance of rain in Pontianak" — the first preposition points at the weather
  // word, not the place. Drop it and look again in what's left.
  if (WEATHER_WORD.test(place)) return placeAfter(place.replace(WEATHER_WORD, ''));
  if (isHere(place)) return null; // current-location questions are handled elsewhere

  return place.replace(/\s+(today|now|right now|tomorrow|please|rn|currently)$/i, '').trim() || null;
};

// "weather in Surabaya", "will it rain in Tokyo", "what is the temp of Pontianak"
export const parseWeatherIn = (text) => {
  const t = text.toLowerCase();
  if (!/\b(weather|forecast|temperature|temp|rain|raining|hot|cold|humid|wind|sunny|climate|conditions?)\b/.test(t)) {
    return null;
  }
  return placeAfter(text);
};
