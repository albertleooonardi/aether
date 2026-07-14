// Deterministic intent parsing for the chat. These decide which async handler
// (weather-in-a-place, or route-with-rain) a message triggers.

const isHere = (s) => /^(my (place|location|home|area|position)|here|me|current location)$/i.test(s.trim());

// "route from X to Y", "directions to Y", "from my place to Grand Indonesia will it rain"
export const parseNavigation = (text) => {
  const t = text.toLowerCase();
  const hasNav =
    (/\bfrom\b/.test(t) && /\bto\b/.test(t)) ||
    /\b(route|directions?|navigate|way)\b.*\bto\b/.test(t) ||
    t.includes('best route');
  if (!hasNav) return null;

  let originText = null;
  let destText = null;

  let m = text.match(/from\s+(.+?)\s+to\s+(.+?)(?:[?.,;]|$)/i);
  if (m) {
    originText = m[1].trim();
    destText = m[2].trim();
  } else {
    m = text.match(/(?:route|directions?|navigate|way|go|get)\s+to\s+(.+?)(?:[?.,;]|$)/i);
    if (m) destText = m[1].trim();
  }
  if (!destText) return null;

  // Trim trailing question clauses that slip past the comma (no punctuation case).
  destText = destText.replace(/\s+(is|are|will|does|do|can|and|when|any|if|should)\b.*$/i, '').trim();
  if (originText) originText = originText.replace(/\s+(is|are|will|does|do|can|and|when|any|if)\b.*$/i, '').trim();

  return {
    originText: originText && !isHere(originText) ? originText : null, // null → use current location
    destText,
    asksRain: /\brain|wet|umbrella|storm|shower/.test(t),
  };
};

// "weather in Surabaya", "will it rain in Tokyo", "how hot is it in London"
export const parseWeatherIn = (text) => {
  const t = text.toLowerCase();
  if (!/\b(weather|forecast|temperature|temp|rain|raining|hot|cold|humid|wind|sunny|climate|conditions?)\b/.test(t)) {
    return null;
  }
  const m = text.match(/\b(?:in|at|for)\s+([A-Za-z][^?.,;]*)/);
  if (!m) return null;

  let place = m[1].trim();
  if (isHere(place)) return null; // current-location questions are handled elsewhere
  place = place.replace(/\s+(today|now|right now|tomorrow|please|rn|currently)$/i, '').trim();
  return place || null;
};
