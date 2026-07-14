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

// Lightweight current-conditions lookup (used to sample rain along a route).
export const fetchCurrent = async (q) => {
  const url = `${WEATHER_BASE_URL}/current.json?key=${WEATHER_API_KEY}&q=${encodeURIComponent(q)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Unable to fetch current conditions');
  }
  return response.json();
};
