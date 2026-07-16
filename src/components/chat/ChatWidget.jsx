import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Bell, Sparkles, Activity } from 'lucide-react';
import { parseReminder, answer, formatClock } from '../../chat/assistant';
import { parseNavigation, parseWeatherIn, parseMapsUrl, parseFollowUp } from '../../chat/intents';
import { fetchWeatherByCity } from '../../services/WeatherService';
import { geocode, geocodeCandidates, resolveMapsUrl } from '../../services/GeoService';
import { getRoutesWithRain } from '../../services/RouteService';
import { askAI, checkAI, getUsage } from '../../services/AetherAI';
import RichText from './RichText';
import WeatherReplyCard from './WeatherReplyCard';
import ChatRouteMap from './ChatRouteMap';
import PlacePicker from './PlacePicker';
import UsagePanel from './UsagePanel';

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

const ChatWidget = ({ weather, hourly = [], forecast = [] }) => {
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
  const [aiReady, setAiReady] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [usage, setUsage] = useState(null);
  const [activeProvider, setActiveProvider] = useState(null);
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

  // Is the Gemini-backed AetherAI backend reachable?
  useEffect(() => {
    checkAI().then(setAiReady);
  }, []);

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
        setAiReady(true);
        setUsage(out.usage);
        setActiveProvider(out.provider);
        sayAssistant(out.reply);
      } catch {
        sayAssistant(answer(text, weatherRef.current, reminders, hourlyRef.current, forecastRef.current));
      }
    } finally {
      setBusy(false);
    }
  };

  const activeCount = reminders.filter((r) => r.dueEpoch > Date.now()).length;

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close assistant' : 'Open assistant'}
        // On phones the open chat covers the whole screen (closing moves to the
        // header ✕), so the floating toggle hides; from sm up it stays.
        className={`${
          open ? 'hidden sm:flex' : 'flex'
        } fixed bottom-5 right-5 z-50 h-14 w-14 items-center justify-center rounded-full bg-white text-slate-900 shadow-2xl transition-transform hover:scale-105 active:scale-95 mb-[env(safe-area-inset-bottom)]`}
      >
        {open ? <X size={24} /> : <MessageCircle size={24} />}
        {!open && activeCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-500 px-1 text-[11px] font-bold text-white">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        // Phone: full-screen sheet (dvh tracks the on-screen keyboard). sm+: the
        // familiar floating panel.
        <div className="fixed inset-0 z-50 flex h-dvh w-full flex-col overflow-hidden bg-neutral-900/90 shadow-2xl backdrop-blur-2xl animate-fade-in-up sm:inset-auto sm:bottom-24 sm:right-5 sm:h-[min(660px,82vh)] sm:w-[min(440px,calc(100vw-2rem))] sm:rounded-3xl sm:border sm:border-white/10 sm:bg-neutral-900/85">
          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3.5 pt-[max(0.875rem,env(safe-area-inset-top))] sm:pt-3.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#434D5C]">
              <Sparkles size={17} className="text-[#8C99AC]" />
            </span>
            <div className="flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-white">AetherAI</span>
                {/* Without a provider key the LLM never runs and every reply comes
                    from the small rule-based assistant. Say so, rather than just
                    seeming dim. */}
                {!aiReady && (
                  <span
                    title="No AI provider key is configured, so I'm answering with simple built-in rules. Add GEMINI_API_KEY or GROQ_API_KEY to .env and restart the server."
                    className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300/90"
                  >
                    basic mode
                  </span>
                )}
              </div>
              <div className="text-[11px] text-white/50">
                {weather ? `${weather.city} · ${weather.temp}°` : 'Ask me anything about the weather'}
              </div>
            </div>
            {activeCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-white/70">
                <Bell size={12} /> {activeCount}
              </span>
            )}
            {aiReady && (
              <button
                onClick={() => {
                  setShowUsage((s) => !s);
                  getUsage().then((u) => u && setUsage(u));
                }}
                aria-label="AI usage & models"
                title="AI usage & models"
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                  showUsage ? 'bg-white/15 text-white' : 'text-white/55 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Activity size={16} />
              </button>
            )}
            {/* On phones the sheet covers the floating toggle — close lives here. */}
            <button
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/10 hover:text-white sm:hidden"
            >
              <X size={18} />
            </button>
          </div>

          {showUsage && aiReady && <UsagePanel usage={usage} active={activeProvider} />}

          {/* Messages */}
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-md bg-white px-3.5 py-2 text-sm text-slate-800">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#434D5C]">
                    <Sparkles size={13} className="text-[#8C99AC]" />
                  </span>
                  <div className="min-w-0 max-w-[calc(100%-2.5rem)] flex-1 text-white/90">
                    <RichText text={m.text} />
                    {m.kind === 'weather' && <WeatherReplyCard data={m.data} />}
                    {m.kind === 'route' && <ChatRouteMap data={m.data} />}
                    {m.kind === 'choice' && <PlacePicker data={m.data} onPick={(c) => handlePick(m, c)} />}
                  </div>
                </div>
              )
            )}

            {busy && (
              <div className="flex gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#434D5C]">
                  <Sparkles size={13} className="text-[#8C99AC]" />
                </span>
                <div className="flex items-center gap-1 rounded-2xl bg-white/10 px-3.5 py-3">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div ref={logEnd} />
          </div>

          {/* Quick suggestions */}
          <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-2">
            {SUGGESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => setInput(q)}
                className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/20"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="border-t border-white/10 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-3"
          >
            <div className="flex items-center gap-2 rounded-2xl bg-white/5 p-1.5">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about any place, a route, or set a reminder…"
                disabled={busy}
                // text-base on phones: anything under 16px makes iOS zoom the
                // whole page every time the input is focused.
                className="w-full bg-transparent px-3 py-1.5 text-base text-white placeholder-white/40 outline-none disabled:opacity-60 sm:text-sm"
              />
              <button
                type="submit"
                aria-label="Send"
                disabled={busy}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-slate-900 transition-transform active:scale-95 disabled:opacity-50"
              >
                <Send size={16} />
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
};

export default ChatWidget;
