import { WEATHER_API_KEY, WEATHER_BASE_URL } from './config';

export const fetchWeatherByCoords = async (lat, lon) => {
  const url = `${WEATHER_BASE_URL}/forecast.json?key=${WEATHER_API_KEY}&q=${lat},${lon}&days=4&aqi=yes`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Unable to fetch weather');
  }
  return response.json();
};

export const fetchWeatherByCity = async (cityName) => {
  const url = `${WEATHER_BASE_URL}/forecast.json?key=${WEATHER_API_KEY}&q=${encodeURIComponent(cityName)}&days=4&aqi=yes`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('City not found');
  }
  return response.json();
};

// Lightweight current-conditions lookup.
export const fetchCurrent = async (q) => {
  const url = `${WEATHER_BASE_URL}/current.json?key=${WEATHER_API_KEY}&q=${encodeURIComponent(q)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Unable to fetch current conditions');
  }
  return response.json();
};

// Flat list of hourly forecast entries for a point, used to judge rain at the
// hour a driver would actually be there rather than the hour they asked.
// Two days covers any drive that crosses midnight.
export const fetchForecastHours = async (q, days = 2) => {
  const url = `${WEATHER_BASE_URL}/forecast.json?key=${WEATHER_API_KEY}&q=${encodeURIComponent(
    q
  )}&days=${days}&aqi=no&alerts=no`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Unable to fetch forecast');
  }
  const data = await response.json();
  return (data.forecast?.forecastday || []).flatMap((d) => d.hour || []);
};
