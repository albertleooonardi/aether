import React, { useState, useEffect, useCallback } from 'react';
import { Sun, Moon, ArrowUpRight, CloudSun, Map as MapIcon, Sparkles } from 'lucide-react';
import Logo from './components/Logo';
import { useTheme } from './utils/useTheme';
import MapPage from './components/map/MapPage';
import SearchBar from './components/SearchBar';
import WeatherCard from './components/WeatherCard';
import Section from './components/Section';
import HourlyForecast from './components/HourlyForecast';
import ForecastCard from './components/ForecastCard';
import DetailsGrid from './components/DetailsGrid';
import WeatherAnimations from './components/WeatherAnimations';
import ErrorMessage from './components/ErrorMessage';
import EmptyState from './components/EmptyState';
import ChatWidget from './components/chat/ChatWidget';
import { fetchWeatherByCoords, fetchWeatherByCity } from './services/WeatherService';
import { saveLastCity, loadLastCity } from './services/StorageService';
import { addRecent } from './services/RecentPlaces';
import { getDevicePosition } from './services/Location';
import './App.css';

const App = () => {
  const [city, setCity] = useState('');
  const [weather, setWeather] = useState(null);
  const [forecast, setForecast] = useState([]);
  const [hourly, setHourly] = useState([]);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [locError, setLocError] = useState('');
  const { theme, toggle, isDark } = useTheme();
  const [view, setView] = useState('weather'); // 'weather' | 'map'
  // Mount the map on first visit, then keep it alive across tab switches so
  // pan/zoom/routes survive; hiding is done with CSS.
  const [mapMounted, setMapMounted] = useState(false);
  // A route the chatbot computed and asked to show on the map page.
  const [chatRoute, setChatRoute] = useState(null);
  // Chat open state lives here so the phone tab bar can open it.
  const [chatOpen, setChatOpen] = useState(false);

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

  // On load a failure quietly falls back to the last city; when the person
  // asked ("Near me") they get told why — on iPhone that's usually a setting.
  const getUserLocation = useCallback(async ({ manual = false } = {}) => {
    setLocating(true);
    setLocError('');
    try {
      const { lat, lon } = await getDevicePosition();
      setLocating(false);
      handleFetchByCoords(lat, lon);
    } catch (err) {
      setLocating(false);
      if (manual) setLocError(err.message);
      else handleLoadLastCity();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleLoadLastCity]);

  useEffect(() => {
    getUserLocation();
  }, [getUserLocation]);

  const handleFetchByCoords = async (lat, lon) => {
    setLoading(true);
    setError('');
    setLocError('');

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
    setLocError('');

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
        // "YYYY-MM-DD" parses as UTC midnight, which is the previous day west
        // of Greenwich; anchor it to local midnight instead.
        date: new Date(`${day.date}T00:00`),
        high: Math.round(day.day.maxtemp_c),
        low: Math.round(day.day.mintemp_c),
        weather: day.day.condition.text,
        chanceOfRain: day.day.daily_chance_of_rain ?? 0,
      }));

      setForecast(forecastData);
    }

    await saveLastCity(data.location.name);
    addRecent({
      name: data.location.name,
      label: [data.location.name, data.location.region, data.location.country].filter(Boolean).join(', '),
      lat: data.location.lat,
      lon: data.location.lon,
    });
    // The reading names the place, so the field is cleared for the next search.
    setCity('');
    setLoading(false);
  };

  const handleSearch = () => {
    handleFetchByCity(city);
  };

  // A picked suggestion carries exact coordinates — use them rather than
  // re-resolving the name, which could land on a namesake elsewhere.
  const handlePickPlace = (place) => {
    handleFetchByCoords(place.lat, place.lon);
  };

  // "Full forecast" from a spot on the map.
  const openWeatherAt = (place) => {
    setView('weather');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    handleFetchByCoords(place.lat, place.lon);
  };

  const near = weather && Number.isFinite(weather.lat) ? { lat: weather.lat, lon: weather.lon } : null;

  const search = (
    <SearchBar
      city={city}
      setCity={setCity}
      onSearch={handleSearch}
      onPickPlace={handlePickPlace}
      onLocate={() => getUserLocation({ manual: true })}
      loading={loading}
      locating={locating}
      near={near}
    />
  );

  const isMap = view === 'map';

  return (
    <div
      className={`relative min-h-[100dvh] bg-page transition-colors duration-300 ${
        isMap ? 'h-[100dvh] overflow-hidden sm:h-auto sm:overflow-visible' : ''
      }`}
    >
      {!isMap && <WeatherAnimations weather={weather} />}

      {/* Top bar. On phones the Weather / Map / Ask tabs move to a bottom tab
          bar (the <nav> below is fixed there); from sm up the same buttons sit in
          the centre of this pill. One set of buttons serves both layouts. */}
      <header className="sticky top-0 z-40 px-3 pt-3 md:px-6 md:pt-4">
        <div className="relative mx-auto max-w-4xl">
          <div className="panel-float flex h-14 items-center gap-1 rounded-full pl-2 pr-2 sm:pl-3">
            <button
              onClick={() => setView('weather')}
              aria-label="Aether home"
              className="flex h-10 items-center gap-2.5 rounded-full px-3 text-ink transition hover:bg-ink/[0.05]"
            >
              <Logo size={18} />
              <span className="text-[13px] font-bold tracking-[0.34em]">AETHER</span>
            </button>

            <div className="flex-1" />

            <button
              onClick={toggle}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Light mode' : 'Dark mode'}
              className="flex h-10 w-10 items-center justify-center rounded-full text-ink/55 transition hover:bg-ink/[0.07] hover:text-ink"
            >
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button
              onClick={() => {
                setView('weather');
                getUserLocation({ manual: true });
              }}
              aria-label="Weather at my location"
              className="btn-pill h-10 px-3.5 text-sm sm:px-4"
            >
              <span className="hidden sm:inline">Near me</span>
              <ArrowUpRight size={15} />
            </button>
          </div>

          <nav aria-label="Main" className="tabbar">
            {[
              { id: 'weather', label: 'Weather', icon: CloudSun },
              { id: 'map', label: 'Map', icon: MapIcon },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => {
                  setView(id);
                  setChatOpen(false);
                }}
                aria-pressed={view === id}
                className={`tab ${view === id ? 'tab--active' : ''}`}
              >
                <Icon size={19} className="sm:hidden" aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
            {/* Phones only: the assistant lives in the tab bar instead of a
                floating button that covers the map's bottom sheets. */}
            <button onClick={() => setChatOpen(true)} className={`tab sm:!hidden ${chatOpen ? 'tab--active' : ''}`}>
              <Sparkles size={19} aria-hidden="true" />
              <span>Ask AI</span>
            </button>
          </nav>
        </div>
      </header>

      <main
        className={`relative z-10 mx-auto w-full ${
          isMap ? 'max-w-[1800px] px-3 md:px-6' : 'max-w-6xl px-5 pb-28 sm:pb-0 md:px-10'
        }`}
      >
        {mapMounted && (
          <div className={isMap ? 'pt-3 sm:pb-4 md:pt-4' : 'hidden'}>
            <MapPage
              weather={weather}
              theme={theme}
              visible={isMap}
              initialRoute={chatRoute}
              onRouteShown={() => setChatRoute(null)}
              onOpenWeather={openWeatherAt}
              chatOpen={chatOpen}
            />
          </div>
        )}

        <div className={isMap ? 'hidden' : ''}>
          {/* Hero: search first, then the current reading */}
          <section className="pb-16 pt-10 md:pb-24 md:pt-16">
            {search}
            {locError ? <ErrorMessage message={locError} hint={null} /> : error && <ErrorMessage message={error} />}
            <div className="mt-14 md:mt-20">
              {weather ? (
                <div className={`transition-opacity duration-300 ${loading ? 'opacity-50' : ''}`} aria-busy={loading}>
                  <WeatherCard weather={weather} />
                </div>
              ) : (
                <EmptyState locating={locating} loading={loading} />
              )}
            </div>
          </section>

          {weather && (
            <div className={`transition-opacity duration-300 ${loading ? 'opacity-50' : ''}`}>
              {hourly.length > 0 && (
                <Section
                  index="01"
                  title="Next 12 hours"
                  aside={`Peak ${Math.max(...hourly.map((h) => h.temp))}° · low ${Math.min(...hourly.map((h) => h.temp))}°`}
                >
                  <HourlyForecast hours={hourly} />
                </Section>
              )}
              {forecast.length > 0 && (
                <Section index="02" title={`${forecast.length}-day outlook`} aside="Daily low to high, on a shared scale">
                  <ForecastCard forecast={forecast} />
                </Section>
              )}
              <Section index="03" title="Conditions in detail" aside={`Updated ${weather.localtime?.split(' ')[1] || ''} local time`}>
                <DetailsGrid weather={weather} />
              </Section>

              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline py-10 text-xs text-ink/40">
                <span className="eyebrow !text-[10px]">Aether · Weather, written plainly</span>
                <span>Forecast by WeatherAPI · Radar by RainViewer · Maps by Esri and OpenStreetMap</span>
              </footer>
            </div>
          )}
        </div>
      </main>

      <ChatWidget
        open={chatOpen}
        onOpenChange={setChatOpen}
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
