import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Bell, Sparkles, Activity } from 'lucide-react';
import { parseReminder, answer, formatClock } from '../../chat/assistant';
import { parseNavigation, parseWeatherIn } from '../../chat/intents';
import { fetchWeatherByCity } from '../../services/WeatherService';
import { geocode } from '../../services/GeoService';
import { getRoutesWithRain } from '../../services/RouteService';
import { askAI, checkAI, getUsage } from '../../services/AetherAI';
import RichText from './RichText';
import WeatherReplyCard from './WeatherReplyCard';
import ChatRouteMap from './ChatRouteMap';
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
  'Route from my place to Grand Indonesia — will it rain?',
  'What should I wear today?',
  'Is it a good evening for a run?',
  'Remind me to bring an umbrella at 5pm',
];

const ChatWidget = ({ weather }) => {
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
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Is the Gemini-backed AetherAI backend reachable?
  useEffect(() => {
    checkAI().then(setAiReady);
  }, []);

  // Compact weather context handed to Gemini for grounded answers.
  const aiContext = () => {
    const w = weatherRef.current;
    if (!w) return { location: null };
    return {
      location: {
        city: w.city,
        country: w.country,
        localtime: w.localtime,
        temp_c: w.temp,
        feels_like_c: w.feels_like,
        condition: w.description,
        today_high_c: w.todayHigh,
        today_low_c: w.todayLow,
        chance_of_rain_pct: w.chanceOfRain,
        humidity_pct: w.humidity,
        wind_kph: w.wind,
        uv_index: w.uv,
      },
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
    // Bias the destination search around the origin — you drive from there.
    const destLoc = await geocode(nav.destText, originLoc);
    if (!destLoc) {
      return sayAssistant(`I couldn't find “${nav.destText}”. Try a more specific name (add the city).`);
    }

    let result;
    try {
      result = await getRoutesWithRain(originLoc, destLoc);
    } catch (err) {
      return sayAssistant(
        err.code === 'no_route'
          ? `I couldn't find a driving route from **${originLoc.name}** to **${destLoc.name}** — they don't look connected by road. If I picked the wrong “${nav.destText}”, try adding the city.`
          : `I couldn't fetch driving directions right now (${err.message}).`
      );
    }

    const best = result.routes[result.bestIndex];
    const lvlWord = { dry: 'looks dry the whole way', light: 'has some light rain', wet: 'runs into rain' }[best.rain.level];
    let summary = `Here's the route from **${originLoc.name}** to **${destLoc.name}**.\n`;
    summary +=
      result.routes.length > 1
        ? `I compared ${result.routes.length} routes — the **recommended** one is ${best.distanceKm.toFixed(1)} km (~${Math.round(best.durationMin)} min) and ${lvlWord}.`
        : `It's ${best.distanceKm.toFixed(1)} km (~${Math.round(best.durationMin)} min) and ${lvlWord}.`;
    if (nav.asksRain || best.rain.level !== 'dry') {
      summary +=
        best.rain.level === 'dry'
          ? '\n☂️ You should stay dry — no umbrella needed.'
          : '\n☔ Take an umbrella — expect rain along the way.';
    }

    sayAssistant(summary, {
      kind: 'route',
      data: { origin: originLoc, dest: destLoc, routes: result.routes, bestIndex: result.bestIndex },
    });
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
      // Rich, action-backed intents render cards/maps.
      const nav = parseNavigation(text);
      if (nav) return await handleNavigation(nav);

      const place = parseWeatherIn(text);
      if (place) return await handleWeatherIn(place);

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
        sayAssistant(answer(text, weatherRef.current, reminders));
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
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-white text-slate-900 shadow-2xl transition-transform hover:scale-105 active:scale-95"
      >
        {open ? <X size={24} /> : <MessageCircle size={24} />}
        {!open && activeCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-500 px-1 text-[11px] font-bold text-white">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed bottom-24 right-5 z-50 flex h-[min(660px,82vh)] w-[min(440px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-white/10 bg-neutral-900/85 shadow-2xl backdrop-blur-2xl animate-fade-in-up">
          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#434D5C]">
              <Sparkles size={17} className="text-[#8C99AC]" />
            </span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-white">AetherAI</div>
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
          <form onSubmit={handleSubmit} className="border-t border-white/10 p-3">
            <div className="flex items-center gap-2 rounded-2xl bg-white/5 p-1.5">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about any place, a route, or set a reminder…"
                disabled={busy}
                className="w-full bg-transparent px-3 py-1.5 text-sm text-white placeholder-white/40 outline-none disabled:opacity-60"
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
