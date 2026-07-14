// Central API config. The key comes from .env (REACT_APP_WEATHER_API_KEY); the
// literal fallback keeps the app working if the env var isn't set.
export const WEATHER_API_KEY =
  process.env.REACT_APP_WEATHER_API_KEY;
export const WEATHER_BASE_URL = 'https://api.weatherapi.com/v1';
