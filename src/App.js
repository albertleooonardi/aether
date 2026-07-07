import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import SearchBar from './components/SearchBar';
import RoutesSection from './components/RoutesSection';
import { loadRoutes, createRoute, deleteRoute, normalizeActivity, cap } from './routes/routeStore';
import { buildTimeline, summarize } from './routes/timeline';
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
import { getTheme } from './utils/ThemeUtils';
import './App.css';

const App = () => {
  const [city, setCity] = useState('');
  const [weather, setWeather] = useState(null);
  const [forecast, setForecast] = useState([]);
  const [hourly, setHourly] = useState([]);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [routes, setRoutes] = useState(loadRoutes);
  const [routeForecast, setRouteForecast] = useState(null);
  const forecastDaysRef = useRef([]);

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
    forecastDaysRef.current = data.forecast?.forecastday || [];

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

  const handleDeleteRoute = (id) => {
    setRoutes(deleteRoute(id));
    setRouteForecast((rf) => (rf && routes.find((r) => r.id === id && r.name === rf.routeName) ? null : rf));
  };

  // Interprets route-related chat messages (save / list / forecast). Returns a
  // reply string if it handled the message, otherwise null. Reuses the already
  // loaded forecast — no extra API calls.
  const handleRouteCommand = (text) => {
    const t = text.toLowerCase();
    const activityMatch = t.match(/\b(run|running|walk|walking|bike|biking|cycling|cycle)\b/);
    const mentionsRoute = t.includes('route');
    const wantsSave = t.includes('save') && (mentionsRoute || activityMatch);
    const wantsList = mentionsRoute && (t.includes('list') || t.includes('show') || t.includes('my routes'));
    const wantsForecast =
      (mentionsRoute && (t.includes('forecast') || t.includes('weather') || t.includes('when'))) ||
      (t.startsWith('forecast') && !mentionsRoute && loadRoutes().length > 0);

    if (!wantsSave && !wantsList && !wantsForecast) return null;
    if (!weather) return 'Search a location first so I can anchor your routes there.';

    if (wantsSave) {
      const activity = activityMatch ? normalizeActivity(activityMatch[1]) : 'run';
      const nameMatch = text.match(/(?:called|named)\s+(.+)$/i);
      const name = nameMatch ? nameMatch[1].trim() : `${cap(activity)} near ${weather.city}`;
      const route = createRoute([weather.lat, weather.lon], activity, name);
      setRoutes(loadRoutes());
      return `Saved “${route.name}” — a ${route.distanceKm.toFixed(1)} km loop. Say “forecast my ${activity}” to see the weather along it.`;
    }

    const saved = loadRoutes();
    if (wantsList) {
      if (!saved.length) return 'No saved routes yet. Say “save a run route here” to create one.';
      return 'Your routes:\n' + saved.map((r) => `• ${r.name} — ${r.distanceKm.toFixed(1)} km, ${r.avgPaceMinPerKm} min/km`).join('\n');
    }

    // Forecast
    if (!saved.length) return 'You have no saved routes yet — say “save a run route here” first.';
    const named = saved.find((r) => t.includes(r.name.toLowerCase().split(' ')[0])) ||
      (activityMatch && saved.find((r) => r.activityType === normalizeActivity(activityMatch[1])));
    const route = named || saved[saved.length - 1];
    if (!forecastDaysRef.current.length) return "I don't have the hourly forecast loaded yet — try again in a moment.";
    const timeline = buildTimeline(route, weather.timestamp, forecastDaysRef.current);
    const summary = summarize(timeline, route);
    setRouteForecast({ routeName: route.name, timeline, summary });
    return `${route.name} — ${summary}`;
  };

  const theme = getTheme(weather);

  return (
    <div
      className={`relative min-h-screen overflow-hidden bg-gradient-to-br ${theme.gradient} transition-[background] duration-1000 ease-out`}
    >
      {/* Ambient accent glow that tints the whole scene */}
      <div
        className="pointer-events-none fixed -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full blur-3xl transition-colors duration-1000"
        style={{ background: theme.glow }}
      />
      <div
        className="pointer-events-none fixed bottom-[-160px] right-[-120px] h-[420px] w-[420px] rounded-full blur-3xl transition-colors duration-1000"
        style={{ background: theme.glow }}
      />

      <WeatherAnimations weather={weather} />

      <div className="relative z-10 mx-auto w-full max-w-[1800px] px-4 py-5 md:px-8 md:py-6 lg:px-12">
        {error && <ErrorMessage message={error} />}

        <div className="grid animate-fade-in-up gap-4 lg:grid-cols-5">
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

        {weather && !loading && (
          <div className="mt-4 animate-fade-in-up">
            <RoutesSection routes={routes} routeForecast={routeForecast} onDelete={handleDeleteRoute} />
          </div>
        )}
      </div>

      <ChatWidget weather={weather} onRouteCommand={handleRouteCommand} />
    </div>
  );
};

export default App;
