/*
 * Device location, with the quirks of iPhone Safari handled in one place:
 *  - Geolocation only works on a secure origin (https or localhost). Opened as
 *    http://192.168.x.x from a phone, Safari refuses without ever prompting.
 *  - A high-accuracy (GPS) fix often times out indoors, so on timeout or
 *    "unavailable" we retry once with the coarser network position.
 *  - When it's denied, the fix lives in iOS Settings, so the message says where.
 */

export class LocationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LocationError';
    this.code = code; // 'insecure' | 'unsupported' | 'denied' | 'unavailable' | 'timeout'
  }
}

const isIOS = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPadOS reports itself as a Mac; touch support gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
};

const MESSAGES = {
  insecure:
    'Location needs a secure connection. Open the site over https (or localhost) instead of an http:// network address.',
  unsupported: 'Location is not available in this browser.',
  denied: () =>
    isIOS()
      ? 'Location is blocked. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using. Then in Safari tap aA → Website Settings → Location → Allow, and reload.'
      : "Location is blocked. Allow it in the browser's site settings, then try again.",
  unavailable: "Couldn't find your position right now. Check that Location Services is on and try again.",
  timeout: 'Finding your location took too long. Try again, ideally with a clearer view of the sky or Wi-Fi on.',
};

const fail = (code) => {
  const m = MESSAGES[code];
  return new LocationError(code, typeof m === 'function' ? m() : m);
};

const CODE_OF = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };

const once = (options) =>
  new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });

const toPlace = (pos) => ({
  lat: pos.coords.latitude,
  lon: pos.coords.longitude,
  acc: pos.coords.accuracy,
});

/**
 * Resolves to { lat, lon, acc } or rejects with a LocationError whose message
 * is ready to show the person.
 */
export const getDevicePosition = async ({ maximumAge = 60000 } = {}) => {
  if (typeof window !== 'undefined' && window.isSecureContext === false) throw fail('insecure');
  if (typeof navigator === 'undefined' || !navigator.geolocation) throw fail('unsupported');

  try {
    return toPlace(await once({ enableHighAccuracy: true, timeout: 8000, maximumAge }));
  } catch (err) {
    const code = CODE_OF[err?.code] || 'unavailable';
    if (code === 'denied') throw fail('denied');
    // GPS gave up — a network fix is coarser but usually instant.
    try {
      return toPlace(await once({ enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60000 }));
    } catch (err2) {
      throw fail(CODE_OF[err2?.code] || code);
    }
  }
};
