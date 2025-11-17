const API_KEY = 'd5f1cded8f934b728a581408251711';
const BASE_URL = 'https://api.weatherapi.com/v1';

export const fetchWeatherByCoords = async (lat, lon) => {
  const url = `${BASE_URL}/forecast.json?key=${API_KEY}&q=${lat},${lon}&days=4&aqi=no`;
  console.log('Fetching weather by coords:', url);
  
  const response = await fetch(url);

  if (!response.ok) {
    const errorData = await response.json();
    console.error('API Error:', errorData);
    throw new Error('Unable to fetch weather');
  }

  const data = await response.json();
  console.log('Weather data received:', data);
  return data;
};

export const fetchWeatherByCity = async (cityName) => {
  const url = `${BASE_URL}/forecast.json?key=${API_KEY}&q=${cityName}&days=4&aqi=no`;
  console.log('Fetching weather by city:', url);
  
  const response = await fetch(url);

  if (!response.ok) {
    const errorData = await response.json();
    console.error('API Error:', errorData);
    throw new Error('City not found');
  }

  const data = await response.json();
  console.log('Weather data received:', data);
  return data;
};