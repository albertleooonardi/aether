import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, CloudSun, Map as MapIcon } from 'lucide-react';
import Logo from './components/Logo';
import MapPage from './components/map/MapPage';
import SearchBar from './components/SearchBar';
import WeatherCard from './components/WeatherCard';
import HourlyForecast from './components/HourlyForecast';
import ForecastCard from './components/ForecastCard';
import UVCard from './components/UVCard';
import WindCard from './components/WindCard';
import WeatherAnimations from './components/WeatherAnimations';
import ErrorMessage from './components/ErrorMessage';
import EmptyState from './components/EmptyState';
import ChatWidget from './components/chat/ChatWidget';
import { fetchWeatherByCoords, fetchWeatherByCity } from './services/WeatherService';
import { saveLastCity, loadLastCity } from './services/StorageService';
import './App.css';

const App = () => {
  const [city, setCity] = useState('');
  const [weather, setWeather] = useState(null);
  const [forecast, setForecast] = useState([]);
  const [hourly, setHourly] = useState([]);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState('weather'); // 'weather' | 'map'
  // Mount the map on first visit, then keep it alive across tab switches so
  // pan/zoom/routes survive; hiding is done with CSS.
  const [mapMounted, setMapMounted] = useState(false);
  // A route the chatbot computed and asked to show on the map page.
  const [chatRoute, setChatRoute] = useState(null);

  useEffect(() => {
    if (view === 'map') setMapMounted(true);
  }, [view]);

  const handleLoadLastCity = useCallback(async () => {
    const lastCity = await loadLastCity();
    if (lastCity) {
      setCity(lastCity);
      handleFetchByCity(lastCity);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getUserLocation = useCallback(() => {
    if (navigator.geolocation) {
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocating(false);
          handleFetchByCoords(position.coords.latitude, position.coords.longitude);
        },
        () => {
          setLocating(false);
          handleLoadLastCity();
        }
      );
    } else {
      handleLoadLastCity();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const today = data.forecast?.forecastday?.[0];
    const now = data.location.localtime_epoch;

    setWeather({
      temp: Math.round(data.current.temp_c),
      feels_like: Math.round(data.current.feelslike_c),
      description: data.current.condition.text,
      icon: data.current.condition.text,
      humidity: data.current.humidity,
      wind: data.current.wind_kph,
      windDir: data.current.wind_dir,
      windDegree: data.current.wind_degree,
      gust: data.current.gust_kph,
      pressure: data.current.pressure_mb,
      visibility: data.current.vis_km,
      uv: data.current.uv,
      uvMax: today?.day?.uv ?? data.current.uv,
      cloud: data.current.cloud,
      precipMm: Math.round((today?.day?.totalprecip_mm ?? data.current.precip_mm ?? 0) * 10) / 10,
      dewpoint: Math.round(data.current.dewpoint_c ?? data.current.temp_c),
      isDay: data.current.is_day,
      city: data.location.name,
      region: data.location.region,
      country: data.location.country,
      lat: data.location.lat,
      lon: data.location.lon,
      localtime: data.location.localtime,
      timestamp: data.location.localtime_epoch,
      chanceOfRain: today?.day?.daily_chance_of_rain ?? 0,
      todayHigh: today ? Math.round(today.day.maxtemp_c) : null,
      todayLow: today ? Math.round(today.day.mintemp_c) : null,
      sunrise: today?.astro?.sunrise ?? null,
      sunset: today?.astro?.sunset ?? null,
      aqi: data.current.air_quality?.['us-epa-index'] ?? null,
    });

    // Build the next 12 hours from today + tomorrow's hourly data.
    const hoursSource = [
      ...(data.forecast?.forecastday?.[0]?.hour || []),
      ...(data.forecast?.forecastday?.[1]?.hour || []),
    ];
    const upcoming = hoursSource
      .filter((h) => h.time_epoch >= now - 3600)
      .slice(0, 12)
      .map((h, idx) => ({
        time: h.time,
        label: idx === 0 ? 'Now' : null,
        temp: Math.round(h.temp_c),
        weather: h.condition.text,
        isDay: h.is_day,
        chanceOfRain: h.chance_of_rain ?? 0,
      }));
    setHourly(upcoming);

    // Always show 3 forecast days. Prefer the next 3 upcoming days; if the plan
    // only returns 3 days total (e.g. WeatherAPI free tier), fall back to
    // today + the next 2 so the "3-Day Forecast" always has three cards.
    const days = data.forecast?.forecastday || [];
    if (days.length > 0) {
      const upcoming = days.slice(1);
      const chosen = upcoming.length >= 3 ? upcoming.slice(0, 3) : days.slice(0, 3);
      const forecastData = chosen.map((day) => ({
        date: new Date(day.date),
        high: Math.round(day.day.maxtemp_c),
        low: Math.round(day.day.mintemp_c),
        weather: day.day.condition.text,
        chanceOfRain: day.day.daily_chance_of_rain ?? 0,
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

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: '#181C21' }}>
      <WeatherAnimations weather={weather} />

      <div className="relative z-10 mx-auto w-full max-w-[1800px] px-4 py-5 md:px-8 md:py-6 lg:px-12">
        {/* Brand + view switch */}
        <header className="mb-5 flex items-center gap-3">
          <Logo size={40} />
          <span className="text-xl font-semibold tracking-[0.22em] text-white">AETHER</span>

          <nav className="ml-auto flex gap-1 rounded-2xl glass p-1">
            {[
              { id: 'weather', label: 'Weather', icon: CloudSun },
              { id: 'map', label: 'Map', icon: MapIcon },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                aria-pressed={view === id}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                  view === id ? 'bg-white text-slate-900' : 'text-white/60 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon size={14} />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </nav>
        </header>

        {error && view === 'weather' && <ErrorMessage message={error} />}

        {mapMounted && (
          <div className={view === 'map' ? '' : 'hidden'}>
            <MapPage
              weather={weather}
              visible={view === 'map'}
              initialRoute={chatRoute}
              onRouteShown={() => setChatRoute(null)}
            />
          </div>
        )}

        <div className={view === 'weather' ? 'grid animate-fade-in-up gap-4 lg:grid-cols-5' : 'hidden'}>
          {/* Left: search + hero */}
          <div className="flex flex-col gap-4 lg:col-span-2">
            <SearchBar
              city={city}
              setCity={setCity}
              onSearch={handleSearch}
              onLocate={getUserLocation}
              loading={loading}
              locating={locating}
            />

            {weather && !loading && <WeatherCard weather={weather} className="flex-1" />}

            {loading && (
              <div className="flex flex-1 items-center justify-center rounded-3xl glass py-20">
                <Loader2 size={28} className="animate-spin text-white/70" />
              </div>
            )}

            {!weather && !loading && !error && <EmptyState locating={locating} />}
          </div>

          {/* Right: forecasts + detail cards */}
          {weather && !loading && (
            <div className="flex flex-col gap-4 lg:col-span-3">
              {hourly.length > 0 && <HourlyForecast hours={hourly} />}
              {forecast.length > 0 && <ForecastCard forecast={forecast} />}
              <div className="grid gap-4 sm:grid-cols-2">
                <UVCard weather={weather} />
                <WindCard weather={weather} />
              </div>
            </div>
          )}

          {loading && (
            <div className="hidden items-center justify-center rounded-3xl glass lg:col-span-3 lg:flex">
              <Loader2 size={28} className="animate-spin text-white/60" />
            </div>
          )}
        </div>
      </div>

      <ChatWidget
        weather={weather}
        hourly={hourly}
        forecast={forecast}
        onOpenRoute={(data) => {
          setChatRoute(data);
          setView('map');
        }}
      />
    </div>
  );
};

export default App;
