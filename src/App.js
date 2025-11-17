import React, { useState, useEffect, useCallback } from 'react';
import { Cloud } from 'lucide-react';
import Header from './components/Header';
import SearchBar from './components/SearchBar';
import WeatherCard from './components/WeatherCard';
import ForecastCard from './components/ForecastCard';
import WeatherAnimations from './components/WeatherAnimations';
import ErrorMessage from './components/ErrorMessage';
import { fetchWeatherByCoords, fetchWeatherByCity } from './services/WeatherService';
import { saveLastCity, loadLastCity } from './services/StorageService';
import { getBackgroundColor, getTextColor } from './utils/ThemeUtils';
import './App.css';

const App = () => {
  const [city, setCity] = useState('');
  const [weather, setWeather] = useState(null);
  const [forecast, setForecast] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLoadLastCity = useCallback(async () => {
    const lastCity = await loadLastCity();
    if (lastCity) {
      setCity(lastCity);
      handleFetchByCity(lastCity);
    }
  }, []);

  const getUserLocation = useCallback(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          handleFetchByCoords(position.coords.latitude, position.coords.longitude);
        },
        (error) => {
          console.log('Location access denied, loading last city');
          handleLoadLastCity();
        }
      );
    } else {
      handleLoadLastCity();
    }
  }, [handleLoadLastCity]);

  useEffect(() => {
    getUserLocation();
  }, [getUserLocation]);

  const handleFetchByCoords = async (lat, lon) => {
    setLoading(true);
    setError('');

    try {
      const data = await fetchWeatherByCoords(lat, lon);
      await processWeatherData(data);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleFetchByCity = async (cityName) => {
    if (!cityName.trim()) return;
    
    setLoading(true);
    setError('');

    try {
      const data = await fetchWeatherByCity(cityName);
      await processWeatherData(data);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const processWeatherData = async (data) => {
    // Set current weather
    setWeather({
      temp: Math.round(data.current.temp_c),
      feels_like: Math.round(data.current.feelslike_c),
      description: data.current.condition.text,
      icon: data.current.condition.text,
      humidity: data.current.humidity,
      wind: data.current.wind_kph,
      pressure: data.current.pressure_mb,
      visibility: data.current.vis_km,
      city: data.location.name,
      country: data.location.country,
      timestamp: data.location.localtime_epoch
    });

    // Process forecast data (skip today, get next 3 days)
    if (data.forecast && data.forecast.forecastday && data.forecast.forecastday.length > 0) {
      const forecastData = data.forecast.forecastday.slice(1, 4).map(day => ({
        date: new Date(day.date),
        high: Math.round(day.day.maxtemp_c),
        low: Math.round(day.day.mintemp_c),
        weather: day.day.condition.text
      }));

      setForecast(forecastData);
    }

    await saveLastCity(data.location.name);
    setCity(data.location.name);
    setLoading(false);
  };

  const handleSearch = () => {
    handleFetchByCity(city);
  };

  const textColor = getTextColor(weather);
  const isDark = textColor === 'text-white';

  return (
    <div className={`min-h-screen ${getBackgroundColor(weather)} transition-colors duration-1000 p-4 md:p-8 relative`}>
      <WeatherAnimations weather={weather} />
      
      <div className="max-w-4xl mx-auto relative z-10">
        <Header textColor={textColor} isDark={isDark} />

        <SearchBar 
          city={city}
          setCity={setCity}
          onSearch={handleSearch}
          loading={loading}
          isDark={isDark}
        />

        {error && <ErrorMessage message={error} />}

        {weather && (
          <div className="space-y-6 animate-fade-in">
            <WeatherCard weather={weather} textColor={textColor} isDark={isDark} />
            {forecast.length > 0 && (
              <ForecastCard forecast={forecast} textColor={textColor} isDark={isDark} />
            )}
          </div>
        )}

        {!weather && !loading && (
          <div className={`text-center ${isDark ? 'text-gray-300' : 'text-gray-600'} mt-12`}>
            <Cloud size={64} className={`mx-auto mb-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
            <p className="text-lg">Loading your location...</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;