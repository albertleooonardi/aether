import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Bell, Sparkles, RotateCw, ChevronDown } from 'lucide-react';
import { parseReminder, answer, formatClock } from '../../chat/assistant';
import { parseNavigation, parseWeatherIn, parseMapsUrl, parseFollowUp } from '../../chat/intents';
import { fetchWeatherByCity } from '../../services/WeatherService';
import { geocode, geocodeCandidates, resolveMapsUrl } from '../../services/GeoService';
import { getRoutesWithRain } from '../../services/RouteService';
import { askAI, checkStatus, getProviders } from '../../services/AetherAI';
import RichText from './RichText';
import WeatherReplyCard from './WeatherReplyCard';
import ChatRouteMap from './ChatRouteMap';
import PlacePicker from './PlacePicker';

const STORAGE_KEY = 'vrijeme.reminders.v1';
const loadReminders = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
};
const persist = (rems) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rems));
  } catch {
    /* ignore */
  }
};

// Shape a WeatherAPI response into the compact card model.
const toCard = (data) => {
  const c = data.current;
  const l = data.location;
  const day = data.forecast?.forecastday?.[0]?.day;
  return {
    name: l.name,
    country: [l.region, l.country].filter(Boolean).join(', '),
    temp: Math.round(c.temp_c),
    feelsLike: Math.round(c.feelslike_c),
    condition: c.condition.text,
    icon: c.condition.text,
    isDay: c.is_day,
    humidity: c.humidity,
    wind: c.wind_kph,
    chanceOfRain: day?.daily_chance_of_rain ?? 0,
    high: day ? Math.round(day.maxtemp_c) : Math.round(c.temp_c),
    low: day ? Math.round(day.mintemp_c) : Math.round(c.temp_c),
  };
};

const SUGGESTIONS = [
  'Weather in Surabaya',
  'Any rain when I’m going to Grand Indonesia?',
  'Route from my place to Grand Indonesia — will it rain?',
  'What should I wear today?',
  'Is it a good evening for a run?',
  'Remind me to bring an umbrella at 5pm',
];

// Backend liveness, surfaced in the header so you can tell at a glance whether
// the chatbot is actually running (the honest answer to "is it up on Vercel?").
const STATUS = {
  checking: { dot: 'bg-amber-400', label: 'Connecting…', tone: 'text-ink/50', pulse: true },
  online: { dot: 'bg-emerald-400', label: 'Online', tone: 'text-emerald-500', pulse: false },
  basic: { dot: 'bg-amber-400', label: 'Basic mode', tone: 'text-amber-500', pulse: false },
  offline: { dot: 'bg-rose-500', label: 'Offline', tone: 'text-rose-500', pulse: false },
};

const STATUS_NOTE = {
  basic:
    'The backend is running but no AI key is set, so replies use the built-in rules. Add GEMINI_API_KEY or GROQ_API_KEY.',
  offline:
    "Can't reach the assistant backend — on Vercel the /api function may not be deployed. Replies use the built-in rules meanwhile.",
};

// Which provider is actually serving right now: the primary if it's ready,
// otherwise the first configured backup — mirrors the backend's failover order.
const activeProviderId = (info) => {
  if (!info) return null;
  const order = info.primary === 'groq' ? ['groq', 'gemini'] : ['gemini', 'groq'];
  const by = Object.fromEntries(info.providers.map((p) => [p.id, p]));
  return order.find((id) => by[id]?.configured && by[id]?.available) || null;
};

// Status pill for one provider row.
const providerState = (p, activeId) => {
  if (!p.configured) return { label: 'Not set', dot: 'bg-ink/25', tone: 'text-ink/40' };
  if (p.exhausted) {
    const mins = p.cooldownEndsAt ? Math.max(1, Math.round((p.cooldownEndsAt - Date.now()) / 60000)) : null;
    return { label: mins ? `Rate-limited · ~${mins}m` : 'Rate-limited', dot: 'bg-rose-500', tone: 'text-rose-500' };
  }
  if (p.id === activeId) return { label: 'Active', dot: 'bg-emerald-400', tone: 'text-emerald-500' };
  return { label: 'Standby', dot: 'bg-ink/40', tone: 'text-ink/50' };
};

const ChatWidget = ({ weather, hourly = [], forecast = [], onOpenRoute }) => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: 'intro',
      role: 'assistant',
      text:
        "Hi, I'm **AetherAI** — your weather companion. Try:\n• **“Weather in Surabaya”** — conditions anywhere\n• **“Route from my place to Grand Indonesia, will it rain?”** — I'll map it and find the driest way\n• **“What should I wear today?”** or **“Remind me to grab an umbrella at 5pm”**",
    },
  ]);
  const [reminders, setReminders] = useState(loadReminders);
  // 'checking' | 'online' | 'basic' | 'offline'
  const [status, setStatus] = useState('checking');
  // Expandable per-provider (Gemini/Groq) status, and its data.
  const [showProviders, setShowProviders] = useState(false);
  const [providerInfo, setProviderInfo] = useState(null);
  const timers = useRef({});
  const logEnd = useRef(null);
  const weatherRef = useRef(weather);
  weatherRef.current = weather;
  const hourlyRef = useRef(hourly);
  hourlyRef.current = hourly;
  const forecastRef = useRef(forecast);
  forecastRef.current = forecast;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // A route waiting on the user to say where they actually meant — either by
  // picking from the list or pasting a Google Maps link.
  const pending = useRef(null);
  // The last answered question, so follow-ups like "what about Central Park?"
  // or "how about at 8pm?" re-ask it with only that part changed.
  const lastIntent = useRef(null);

  // Poll backend liveness: once on mount, then every 30s while the sheet is open
  // (and immediately each time it opens), so a backend that comes up or goes down
  // on Vercel is reflected without a page reload.
  const loadProviders = useCallback(() => {
    getProviders().then(setProviderInfo);
  }, []);

  const probe = useCallback(() => {
    setStatus((s) => (s === 'offline' ? 'checking' : s));
    checkStatus().then((r) => setStatus(r.status));
    loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    probe();
    if (!open) return undefined;
    const id = setInterval(probe, 30000);
    return () => clearInterval(id);
  }, [open, probe]);

  // Weather context handed to the AI for grounded answers — the same data the
  // app's own cards render: current conditions, the next hours, and the 3-day
  // forecast, so "later"/"tonight"/"tomorrow" are answered from real numbers.
  const aiContext = () => {
    const w = weatherRef.current;
    if (!w) return { location: null };
    return {
      location: {
        city: w.city,
        region: w.region,
        country: w.country,
        lat: w.lat,
        lon: w.lon,
        localtime: w.localtime,
        temp_c: w.temp,
        feels_like_c: w.feels_like,
        condition: w.description,
        today_high_c: w.todayHigh,
        today_low_c: w.todayLow,
        chance_of_rain_pct: w.chanceOfRain,
        humidity_pct: w.humidity,
        dewpoint_c: w.dewpoint,
        wind_kph: w.wind,
        wind_dir: w.windDir,
        gust_kph: w.gust,
        pressure_mb: w.pressure,
        visibility_km: w.visibility,
        cloud_pct: w.cloud,
        uv_index: w.uv,
        uv_max_today: w.uvMax,
        is_day: w.isDay === 1,
        sunrise: w.sunrise,
        sunset: w.sunset,
        aqi_us_epa: w.aqi,
      },
      hourly_next_hours: hourlyRef.current.map((h) => ({
        time: h.time,
        temp_c: h.temp,
        condition: h.weather,
        chance_of_rain_pct: h.chanceOfRain,
      })),
      forecast_days: forecastRef.current.map((d) => ({
        date: d.date instanceof Date ? d.date.toISOString().slice(0, 10) : d.date,
        high_c: d.high,
        low_c: d.low,
        condition: d.weather,
        chance_of_rain_pct: d.chanceOfRain,
      })),
    };
  };

  const say = (role, text, extra = {}) =>
    setMessages((m) => [...m, { id: `${Date.now()}-${Math.random()}`, role, text, ...extra }]);
  const sayAssistant = (text, extra) => say('assistant', text, extra);

  useEffect(() => {
    if (open) logEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, busy]);

  const fireReminder = useCallback((rem) => {
    say('assistant', `⏰ **Reminder:** ${rem.label}`);
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Aether reminder', { body: rem.label });
    }
    setReminders((prev) => {
      const next = prev.filter((r) => r.id !== rem.id);
      persist(next);
      return next;
    });
    delete timers.current[rem.id];
  }, []);

  const schedule = useCallback(
    (rem) => {
      const delay = rem.dueEpoch - Date.now();
      if (delay <= 0) return fireReminder(rem);
      timers.current[rem.id] = setTimeout(() => fireReminder(rem), delay);
    },
    [fireReminder]
  );

  useEffect(() => {
    const now = Date.now();
    const active = loadReminders().filter((r) => r.dueEpoch > now);
    persist(active);
    setReminders(active);
    active.forEach(schedule);
    const t = timers.current;
    return () => Object.values(t).forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWeatherIn = async (place) => {
    try {
      const data = await fetchWeatherByCity(place);
      const card = toCard(data);
      lastIntent.current = { type: 'weather', place: card.name };
      sayAssistant(`Here's **${card.name}** right now — ${card.condition.toLowerCase()}, ${card.temp}°.`, {
        kind: 'weather',
        data: card,
      });
    } catch {
      sayAssistant(`I couldn't find weather for “${place}”. Try a different spelling or a nearby city.`);
    }
  };

  const handleNavigation = async (nav) => {
    const w = weatherRef.current;
    const here = w && Number.isFinite(w.lat) ? { lat: w.lat, lon: w.lon } : null;
    const originLoc = nav.originText
      ? await geocode(nav.originText, here)
      : w
      ? { name: w.city, lat: w.lat, lon: w.lon }
      : null;

    if (!originLoc) {
      return sayAssistant(
        nav.originText
          ? `I couldn't find your starting point “${nav.originText}”.`
          : 'Search a city in the app first so I can use it as your starting point.'
      );
    }

    // A pasted Google Maps link is already an exact spot — no guessing needed.
    if (nav.isUrl) {
      const pin = await resolveMapsUrl(nav.destText);
      if (!pin) {
        return sayAssistant(
          "I couldn't read a location out of that link. Open it in Google Maps, then copy the URL from the address bar — the one with coordinates in it."
        );
      }
      return await runRoute(nav, originLoc, pin);
    }

    // Bias the destination search around the origin — you drive from there.
    const candidates = await geocodeCandidates(nav.destText, originLoc);
    if (!candidates.length) {
      pending.current = { nav, originLoc };
      return sayAssistant(
        `I couldn't find “${nav.destText}”. Try adding the city — or paste a Google Maps link and I'll use that exact spot.`
      );
    }
    // One clear hit: just go. Several: ask, rather than betting on the top one.
    if (candidates.length === 1) return await runRoute(nav, originLoc, candidates[0]);

    pending.current = { nav, originLoc };
    // The question carries its own context: picking from an older picker must
    // route that request, not whichever one was asked most recently.
    return sayAssistant(`I found a few places called “${nav.destText}” — which one did you mean?`, {
      kind: 'choice',
      data: { query: nav.destText, candidates, origin: originLoc, chosen: null, nav },
    });
  };

  // Resolve a picked/pasted destination into an actual routed answer.
  const runRoute = async (nav, originLoc, destLoc) => {
    const departAt = nav.departAt || Date.now();
    let result;
    try {
      result = await getRoutesWithRain(originLoc, destLoc, departAt);
    } catch (err) {
      return sayAssistant(
        err.code === 'no_route'
          ? `I couldn't find a driving route from **${originLoc.name}** to **${destLoc.name}** — they don't look connected by road. If I picked the wrong “${nav.destText}”, try adding the city.`
          : `I couldn't fetch driving directions right now (${err.message}).`
      );
    }

    const best = result.routes[result.bestIndex];
    const WORD = {
      dry: 'stays dry the whole way',
      light: 'catches a little light rain',
      wet: 'runs into rain',
      unknown: "couldn't be checked for rain",
    };
    const ADVICE = {
      dry: '\n☂️ You should stay dry — no umbrella needed.',
      light: '\n🌂 Maybe pack an umbrella — only light rain forecast on the way.',
      wet: '\n☔ Take an umbrella — rain is forecast while you’d be driving.',
      unknown: '\n🤷 I couldn’t reach the weather service for this route, so I can’t call it either way.',
    };
    const lvl = best.rain.level;
    const leaving = nav.departAt ? `leaving ${formatClock(departAt)}` : 'leaving now';

    let summary = `Here's the route from **${originLoc.name}** to **${destLoc.name}**.\n`;
    summary +=
      result.routes.length > 1
        ? `I compared ${result.routes.length} routes — the **recommended** one is ${best.distanceKm.toFixed(1)} km (~${Math.round(best.durationMin)} min) and ${WORD[lvl]}.`
        : `It's ${best.distanceKm.toFixed(1)} km (~${Math.round(best.durationMin)} min) and ${WORD[lvl]}.`;
    // Say what was actually checked — the claim is about the drive, not about now.
    if (lvl !== 'unknown') {
      summary += `\nChecked the forecast along the way for ${leaving}, arriving ~${formatClock(best.arriveAt)}.`;
    }
    if (nav.asksRain || lvl !== 'dry') summary += ADVICE[lvl];

    lastIntent.current = { type: 'route', nav, origin: originLoc, dest: destLoc };
    sayAssistant(summary, {
      kind: 'route',
      data: { origin: originLoc, dest: destLoc, routes: result.routes, bestIndex: result.bestIndex },
    });
  };

  // User tapped one of the candidates. Lock the list to the choice so the picker
  // reads as a settled answer, then route to it.
  const handlePick = async (msg, choice) => {
    if (busy) return;
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, data: { ...m.data, chosen: choice } } : m)));
    pending.current = null; // this question is answered
    setBusy(true);
    try {
      await runRoute(msg.data.nav, msg.data.origin, choice);
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    say('user', text);

    // Reminders (synchronous)
    const rem = parseReminder(text);
    if (rem) {
      const reminder = { id: `${Date.now()}`, ...rem };
      setReminders((prev) => {
        const next = [...prev, reminder];
        persist(next);
        return next;
      });
      schedule(reminder);
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
      sayAssistant(`Got it — I'll remind you to **${reminder.label}** at ${formatClock(reminder.dueEpoch)}.`);
      return;
    }

    setBusy(true);
    try {
      // A bare Google Maps link answers a route we already asked about — no need
      // to repeat "route to …" around it.
      const url = parseMapsUrl(text);
      if (url && pending.current) {
        const p = pending.current;
        pending.current = null;
        const pin = await resolveMapsUrl(url);
        if (!pin) {
          return sayAssistant(
            "I couldn't read a location out of that link. Open it in Google Maps, then copy the URL from the address bar — the one with coordinates in it."
          );
        }
        return await runRoute(p.nav, p.originLoc, pin);
      }

      // Rich, action-backed intents render cards/maps.
      const nav = parseNavigation(text);
      if (nav) return await handleNavigation(nav);

      const place = parseWeatherIn(text);
      if (place) return await handleWeatherIn(place);

      // "What about Central Park?" / "how about at 8pm?" — re-ask the previous
      // question with just that part swapped.
      const fu = parseFollowUp(text);
      const last = lastIntent.current;
      if (fu && last) {
        if (fu.place) {
          if (last.type === 'route') {
            return await handleNavigation({
              ...last.nav,
              destText: fu.place,
              isUrl: false,
              departAt: fu.departAt ?? last.nav.departAt,
            });
          }
          return await handleWeatherIn(fu.place);
        }
        if (fu.departAt && last.type === 'route') {
          return await runRoute({ ...last.nav, departAt: fu.departAt }, last.origin, last.dest);
        }
      }

      // Everything else → Gemini (AetherAI), grounded with weather context.
      // Falls back to the local assistant if the AI backend/key is unavailable.
      try {
        const history = messagesRef.current
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, text: m.text }));
        history.push({ role: 'user', text });
        const out = await askAI(history, aiContext());
        setStatus('online'); // a real reply just came back — definitely up
        sayAssistant(out.reply);
      } catch {
        sayAssistant(answer(text, weatherRef.current, reminders, hourlyRef.current, forecastRef.current));
      }
    } finally {
      setBusy(false);
    }
  };

  const activeCount = reminders.filter((r) => r.dueEpoch > Date.now()).length;
  const meta = STATUS[status] || STATUS.checking;

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        // On phones the open chat covers the whole screen (closing moves to the
        // header ✕), so the floating toggle hides; from sm up it stays.
        className={`${
          open ? 'hidden sm:flex' : 'flex'
        } fixed bottom-5 right-5 z-50 h-14 w-14 items-center justify-center rounded-full bg-accent text-accentFg shadow-2xl transition-transform hover:scale-105 active:scale-95 mb-[env(safe-area-inset-bottom)]`}
      >
        {open ? <X size={24} /> : <MessageCircle size={24} />}
        {/* Liveness dot, so the backend's state is visible without opening the
            chat — the whole point of the status work. */}
        {!open && (
          <span
            title={`Assistant: ${meta.label}`}
            className={`absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-page ${meta.dot} ${
              meta.pulse ? 'animate-pulse' : ''
            }`}
          />
        )}
        {!open && activeCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-500 px-1 text-[11px] font-bold text-white">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        // Phone: full-screen sheet (dvh tracks the on-screen keyboard). sm+: the
        // familiar floating panel.
        <div className="fixed inset-0 z-50 flex h-dvh w-full flex-col overflow-hidden bg-panel/90 shadow-2xl backdrop-blur-2xl animate-fade-in-up sm:inset-auto sm:bottom-24 sm:right-5 sm:h-[min(660px,82vh)] sm:w-[min(440px,calc(100vw-2rem))] sm:rounded-3xl sm:border sm:border-ink/10 sm:bg-panel/85">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-ink/10 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-3">
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#434D5C]">
              <Sparkles size={16} className="text-[#8C99AC]" />
              {/* Status ring on the avatar mirrors the header label. */}
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-panel ${meta.dot} ${
                  meta.pulse ? 'animate-pulse' : ''
                }`}
              />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-tight text-ink">AetherAI</div>
              {/* Live status — click to expand per-provider (Gemini/Groq) status. */}
              <button
                onClick={() => {
                  setShowProviders((v) => !v);
                  probe();
                }}
                title="Gemini & Groq status"
                aria-expanded={showProviders}
                className="mt-0.5 flex items-center gap-1.5 text-[11px] transition-opacity hover:opacity-80"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${meta.pulse ? 'animate-pulse' : ''}`} />
                <span className={`font-medium ${meta.tone}`}>{meta.label}</span>
                {weather && <span className="truncate text-ink/40">· {weather.city} {weather.temp}°</span>}
                <ChevronDown
                  size={11}
                  className={`text-ink/40 transition-transform ${showProviders ? 'rotate-180' : ''}`}
                />
              </button>
            </div>
            {activeCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-ink/10 px-2.5 py-1 text-[11px] text-ink/70">
                <Bell size={12} /> {activeCount}
              </span>
            )}
            {/* On phones the sheet covers the floating toggle — close lives here. */}
            <button
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/55 transition-colors hover:bg-ink/10 hover:text-ink sm:hidden"
            >
              <X size={18} />
            </button>
          </div>

          {/* Per-provider (Gemini / Groq) status, expanded from the header. */}
          {showProviders && (
            <div className="border-b border-ink/10 bg-ink/[0.03] px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/40">AI providers</span>
                <button
                  onClick={probe}
                  title="Refresh"
                  className="flex items-center gap-1 text-[10px] text-ink/45 transition-colors hover:text-ink"
                >
                  <RotateCw size={10} /> Refresh
                </button>
              </div>

              {status === 'offline' ? (
                <p className="text-[11px] leading-snug text-rose-500">
                  Backend unreachable — on Vercel the <span className="font-mono">/api</span> function may not be
                  deployed. Replies fall back to the built-in rules.
                </p>
              ) : !providerInfo ? (
                <p className="text-[11px] text-ink/45">Checking Gemini and Groq…</p>
              ) : (
                <div className="space-y-1.5">
                  {providerInfo.providers.map((p) => {
                    const st = providerState(p, activeProviderId(providerInfo));
                    return (
                      <div key={p.id} className="flex items-center gap-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} />
                        <span className="text-[13px] font-medium text-ink">{p.label}</span>
                        {p.id === providerInfo.primary && (
                          <span className="rounded-full bg-ink/10 px-1.5 py-px text-[9px] font-medium text-ink/50">
                            primary
                          </span>
                        )}
                        <span className="truncate font-mono text-[10px] text-ink/35">{p.model}</span>
                        <span className={`ml-auto shrink-0 text-[11px] font-medium ${st.tone}`}>{st.label}</span>
                      </div>
                    );
                  })}
                  {status === 'basic' && (
                    <p className="pt-1 text-[10px] leading-snug text-amber-500">
                      No key configured — add GEMINI_API_KEY or GROQ_API_KEY, then Refresh.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* When the LLM isn't available, say why and what to do — this is the
              thing that was impossible to diagnose on Vercel before. Hidden while
              the provider panel is open, since that already explains it. */}
          {STATUS_NOTE[status] && !showProviders && (
            <div
              className={`border-b border-ink/10 px-4 py-2 text-[11px] leading-snug ${
                status === 'offline' ? 'bg-rose-500/10 text-rose-500' : 'bg-amber-400/10 text-amber-500'
              }`}
            >
              {STATUS_NOTE[status]}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5">
            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-line rounded-2xl bg-ink/[0.07] px-4 py-2.5 text-[14.5px] leading-relaxed text-ink">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#434D5C]">
                    <Sparkles size={13} className="text-[#8C99AC]" />
                  </span>
                  <div className="min-w-0 max-w-[calc(100%-2.5rem)] flex-1 text-[14.5px] leading-relaxed text-ink/85">
                    <RichText text={m.text} />
                    {m.kind === 'weather' && <WeatherReplyCard data={m.data} />}
                    {m.kind === 'route' && (
                      <ChatRouteMap
                        data={m.data}
                        onOpenInMap={
                          onOpenRoute
                            ? (d) => {
                                // Hand the already-computed route to the full map
                                // page and get the chat sheet out of its way.
                                onOpenRoute(d);
                                setOpen(false);
                              }
                            : undefined
                        }
                      />
                    )}
                    {m.kind === 'choice' && <PlacePicker data={m.data} onPick={(c) => handlePick(m, c)} />}
                  </div>
                </div>
              )
            )}

            {busy && (
              <div className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#434D5C]">
                  <Sparkles size={13} className="text-[#8C99AC]" />
                </span>
                <div className="flex items-center gap-1 py-2">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/40"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={logEnd} />
          </div>

          {/* Starter prompts — shown only before the conversation begins, the way
              Claude offers suggestions on an empty thread, then gets out of the way. */}
          {messages.length <= 1 && (
            <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-2">
              {SUGGESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => setInput(q)}
                  className="shrink-0 rounded-full border border-ink/15 px-3 py-1.5 text-xs text-ink/70 transition-colors hover:border-ink/30 hover:bg-ink/5 hover:text-ink"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3"
          >
            <div className="flex items-end gap-2 rounded-[1.4rem] border border-ink/12 bg-ink/[0.04] p-1.5 pl-2 transition-colors focus-within:border-ink/25 focus-within:bg-ink/[0.06]">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Message AetherAI…"
                disabled={busy}
                // text-base on phones: anything under 16px makes iOS zoom the
                // whole page every time the input is focused.
                className="w-full bg-transparent px-2.5 py-2 text-base text-ink placeholder-ink/40 outline-none disabled:opacity-60 sm:text-sm"
              />
              <button
                type="submit"
                aria-label="Send"
                disabled={busy || !input.trim()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accentFg transition-transform active:scale-95 disabled:opacity-30"
              >
                <Send size={15} />
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
};

export default ChatWidget;
