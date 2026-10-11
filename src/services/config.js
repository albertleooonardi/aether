// Central API config. The key comes from .env (REACT_APP_WEATHER_API_KEY); the
// literal fallback keeps the app working if the env var isn't set.
export const WEATHER_API_KEY =
  process.env.REACT_APP_WEATHER_API_KEY;
export const WEATHER_BASE_URL = 'https://api.weatherapi.com/v1';

// 8s abort budget for an upstream geocode/route fetch (same as fetchJSON in
// api/_lib/core.js), so a stalled request can't pin the chat turn's `busy` flag
// forever. Each call returns a NEW signal, so the bound is per signal, not per
// turn: geocodeCandidates gives each source its own (5s) signal under a 12s overall
// cap, but a route turn geocodes twice and then routes, so a
// fully stalled turn can still hold `busy` for one budget per stage, not one total. AbortSignal.timeout is missing in older Safari and in jsdom; there the
// fetch simply runs unbounded, exactly as before.
export const upstreamSignal = (ms = 8000) =>
  typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;

// Browser budget for the proxied /api/route call. It must EXCEED routeHandler's
// worst case (ROUTE_PROXY_WORST_CASE_MS in api/_lib/core.js, 12.4s), otherwise the
// client gives up on a proxy that is still retrying and calls public OSRM directly
// from the browser. 15s = that worst case + ~2.6s for network and cold start.
// Change one, change the other (RouteService.test.js checks the relationship).
export const ROUTE_PROXY_TIMEOUT_MS = 15000;
