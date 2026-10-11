import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Bell, Sparkles, RotateCw, Trash2 } from 'lucide-react';
import { parseReminder, answer, formatClock, routeSummary } from '../../chat/assistant';
import { parseNavigation, parseWeatherIn, parseMapsUrl, parseFollowUp } from '../../chat/intents';
import { fetchWeatherByCity } from '../../services/WeatherService';
import { geocode, geocodeCandidates, resolveMapsUrl } from '../../services/GeoService';
import { getRoutesWithRain } from '../../services/RouteService';
import { askAI, checkStatus, logTurn } from '../../services/AetherAI';
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

// The intro message is shown whenever there's no stored transcript to
// restore — kept as a constant so "clear chat" can put the widget back in
// exactly this state.
const INTRO_MESSAGE = {
  id: 'intro',
  role: 'assistant',
  text:
    "Hi, I'm **AetherAI** — your weather companion. Try:\n• **“Weather in Surabaya”** — conditions anywhere\n• **“Route from my place to Grand Indonesia, will it rain?”** — I'll map it and find the driest way\n• **“What should I wear today?”** or **“Remind me to grab an umbrella at 5pm”**",
};

const CHAT_STORAGE_KEY = 'vrijeme.chat.v1';
// Keep the stored transcript well clear of the ~5MB localStorage budget.
const MAX_STORED_MESSAGES = 50;

// Messages can carry a 'weather'/'route'/'choice' payload (a live card, map,
// or picker). None of that survives a refresh meaningfully — weather/route
// data goes stale, and a picker's onPick handler lives in `pending.current`,
// which is gone — so only the plain text/role is ever persisted or restored.
// A card-only message (the map drawn after an LLM-written route answer has no
// prose of its own) would come back as an empty bubble once its card is gone, so
// it is dropped rather than persisted.
export const stripExtras = (msgs) => msgs.filter((m) => m.text).map(({ id, role, text }) => ({ id, role, text }));

// What the user can see right now, shaped for the model: the route card's rows
// (same labels the card renders, so "Option 2" means a row they can tap) and any
// reminder still pending. Deliberately tiny — it ships on every request — so no
// coordinates, polylines or per-segment rain. Returns null when nothing is shown,
// so a plain weather turn's payload is unchanged.
export const displayedContext = (card, reminders, now = Date.now()) => {
  const out = {};
  if (card && Array.isArray(card.routes) && card.routes.length) {
    out.route = {
      origin: card.origin?.name,
      destination: card.dest?.name,
      shown_at: formatClock(card.shownAt ?? now),
      options: card.routes.map((r, i) => ({
        label: i === card.bestIndex ? 'Recommended' : `Option ${i + 1}`,
        distance_km: Math.round(r.distanceKm * 10) / 10,
        duration_min: Math.round(r.durationMin),
        rain: r.rain?.level || 'dry',
      })),
    };
  }
  const active = (reminders || []).filter((r) => r.dueEpoch > now);
  if (active.length) out.reminders = active.map((r) => ({ label: r.label, due: formatClock(r.dueEpoch) }));
  return Object.keys(out).length ? out : null;
};

export const loadChat = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY));
    if (!Array.isArray(raw)) return null;
    return stripExtras(raw);
  } catch {
    return null;
  }
};

export const saveChat = (msgs) => {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(stripExtras(msgs).slice(-MAX_STORED_MESSAGES)));
  } catch {
    /* ignore */
  }
};

export const clearChat = () => {
  try {
    localStorage.removeItem(CHAT_STORAGE_KEY);
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

const ChatWidget = ({ weather, hourly = [], forecast = [], onOpenRoute }) => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState(() => {
    const stored = loadChat();
    return stored && stored.length ? stored : [INTRO_MESSAGE];
  });
  const [reminders, setReminders] = useState(loadReminders);
  // 'checking' | 'online' | 'basic' | 'offline'
  const [status, setStatus] = useState('checking');
  // Bumped by clearConversation. Each turn captures it (myEpoch) when it starts and
  // threads that value through its whole call chain; say() drops output from a turn
  // whose captured epoch no longer matches. There is deliberately NO shared
  // "current turn" ref: clearing releases busy while the old turn is in flight, so
  // turns overlap, and a shared ref lets a newer turn re-admit the older one's reply.
  const epoch = useRef(0);
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
  // The route card currently on screen (card payload + draw time), sent to the AI
  // as `displayed` so it doesn't re-describe what the user can already see.
  const lastCard = useRef(null);

  // Poll backend liveness: once on mount, then every 30s while the sheet is open
  // (and immediately each time it opens), so a backend that comes up or goes down
  // on Vercel is reflected without a page reload.
  const probe = useCallback(() => {
    setStatus((s) => (s === 'offline' ? 'checking' : s));
    checkStatus().then((r) => setStatus(r.status));
  }, []);

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
    const displayed = displayedContext(lastCard.current, reminders);
    if (!w) return displayed ? { location: null, displayed } : { location: null };
    return {
      ...(displayed && { displayed }),
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

  const append = (role, text, extra = {}) => {
    setMessages((m) => [...m, { id: `${Date.now()}-${Math.random()}`, role, text, ...extra }]);
  };
  // The one definition of "this turn no longer belongs to the current
  // conversation": a turn began before the chat was cleared. Such a turn must not
  // append, persist, or write lastIntent/pending, or the "cleared" exchange
  // resurrects on refresh and follow-ups answer against deleted context.
  // Always tested against the epoch the turn itself captured, never shared state.
  const isStaleTurn = (turnEpoch) => turnEpoch !== epoch.current;
  // Output that originates from a turn. Reminders are NOT part of a turn and go
  // through append() directly: a timer can fire inside a stale turn's window, and
  // dropping it here would still consume it (state + localStorage) unseen.
  // A call with no turnEpoch (the user's own message, which is not turn output) is
  // never stale.
  const say = (role, text, extra = {}, turnEpoch) => {
    if (turnEpoch !== undefined && isStaleTurn(turnEpoch)) return;
    append(role, text, extra);
  };

  useEffect(() => {
    if (open) logEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, busy]);

  // Persist on every change so a refresh restores the conversation instead of
  // starting cold — extras (weather/route/choice payloads) are stripped by
  // saveChat itself, not just on the way back in.
  useEffect(() => {
    saveChat(messages);
  }, [messages]);

  // Once a transcript persists on disk it's a record of where the user's
  // been and where they were going — give them a way to delete it. Slots
  // that reference geocoded/in-flight state don't survive a refresh anyway,
  // so clear them too rather than leave them stale.
  const clearConversation = () => {
    epoch.current += 1; // any in-flight turn is now stale (each turn holds its own captured epoch)
    clearChat();
    setMessages([INTRO_MESSAGE]);
    lastIntent.current = null;
    lastCard.current = null;
    pending.current = null;
    // Release the composer now rather than when the stalled turn finally settles
    // (up to 45s); the epoch guard discards its reply. The turn's own finally only
    // touches busy if it is still the current conversation's turn.
    setBusy(false);
  };

  const fireReminder = useCallback((rem) => {
    append('assistant', `⏰ **Reminder:** ${rem.label}`);
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

  const handleWeatherIn = async (place, meta = {}) => {
    const { handler = 'weather-in', rawText = place, epoch: myEpoch = epoch.current } = meta;
    const sayAssistant = (text, extra) => say('assistant', text, extra, myEpoch);
    const startedAt = Date.now();
    try {
      const data = await fetchWeatherByCity(place);
      const card = toCard(data);
      if (!isStaleTurn(myEpoch)) lastIntent.current = { type: 'weather', place: card.name };
      sayAssistant(`Here's **${card.name}** right now — ${card.condition.toLowerCase()}, ${card.temp}°.`, {
        kind: 'weather',
        data: card,
      });
      logTurn({
        handler,
        message: rawText,
        parsed: { place },
        outcome: 'ok',
        city: card.name,
        latency_ms: Date.now() - startedAt,
      });
    } catch {
      sayAssistant(`I couldn't find weather for “${place}”. Try a different spelling or a nearby city.`);
      // The place the user asked about couldn't be geocoded/looked up — this
      // is exactly the "geocode_failed" standing bug report this logging
      // exists for.
      logTurn({
        handler,
        message: rawText,
        parsed: { place },
        outcome: 'geocode_failed',
        city: place,
        latency_ms: Date.now() - startedAt,
      });
    }
  };

  const handleNavigation = async (nav, meta = {}) => {
    const { handler = 'route', rawText = nav.destText, epoch: myEpoch = epoch.current } = meta;
    const sayAssistant = (text, extra) => say('assistant', text, extra, myEpoch);
    const startedAt = Date.now();
    const w = weatherRef.current;
    const here = w && Number.isFinite(w.lat) ? { lat: w.lat, lon: w.lon } : null;
    const originLoc = nav.originText
      ? await geocode(nav.originText, here)
      : w
      ? { name: w.city, lat: w.lat, lon: w.lon }
      : null;

    if (!originLoc) {
      sayAssistant(
        nav.originText
          ? `I couldn't find your starting point “${nav.originText}”.`
          : 'Search a city in the app first so I can use it as your starting point.'
      );
      // Origin couldn't be resolved to a place at all — a geocode failure.
      logTurn({
        handler,
        message: rawText,
        parsed: { origin: nav.originText || null, destination: nav.destText },
        outcome: 'geocode_failed',
        city: nav.originText || null,
        latency_ms: Date.now() - startedAt,
      });
      return;
    }

    // A pasted Google Maps link is already an exact spot — no guessing needed.
    if (nav.isUrl) {
      const pin = await resolveMapsUrl(nav.destText);
      if (!pin) {
        sayAssistant(
          "I couldn't read a location out of that link. Open it in Google Maps, then copy the URL from the address bar — the one with coordinates in it."
        );
        logTurn({
          handler,
          message: rawText,
          parsed: { origin: originLoc.name, destination: nav.destText },
          outcome: 'geocode_failed',
          city: originLoc.name,
          latency_ms: Date.now() - startedAt,
        });
        return;
      }
      return await runRoute(nav, originLoc, pin, { handler, rawText, epoch: myEpoch });
    }

    // Bias the destination search around the origin — you drive from there.
    const candidates = await geocodeCandidates(nav.destText, originLoc);
    if (!candidates.length) {
      if (!isStaleTurn(myEpoch)) pending.current = { nav, originLoc };
      sayAssistant(
        `I couldn't find “${nav.destText}”. Try adding the city — or paste a Google Maps link and I'll use that exact spot.`
      );
      // Destination geocode returned nothing — same failure class as the
      // origin case above.
      logTurn({
        handler,
        message: rawText,
        parsed: { origin: originLoc.name, destination: nav.destText },
        outcome: 'geocode_failed',
        city: originLoc.name,
        latency_ms: Date.now() - startedAt,
      });
      return;
    }
    // One clear hit: just go. Several: ask, rather than betting on the top one.
    if (candidates.length === 1) return await runRoute(nav, originLoc, candidates[0], { handler, rawText, epoch: myEpoch });

    if (!isStaleTurn(myEpoch)) pending.current = { nav, originLoc };
    // The question carries its own context: picking from an older picker must
    // route that request, not whichever one was asked most recently.
    sayAssistant(`I found a few places called “${nav.destText}” — which one did you mean?`, {
      kind: 'choice',
      data: { query: nav.destText, candidates, origin: originLoc, chosen: null, nav },
    });
    logTurn({
      handler,
      message: rawText,
      parsed: { origin: originLoc.name, destination: nav.destText },
      outcome: 'ok',
      city: originLoc.name,
      latency_ms: Date.now() - startedAt,
    });
  };

  // The card half of a route answer, shared by the deterministic path (runRoute,
  // which adds its own narration) and the LLM path (renderAiRoute, which must not).
  const routeCard = (originLoc, destLoc, result) => ({
    kind: 'route',
    data: { origin: originLoc, dest: destLoc, routes: result.routes, bestIndex: result.bestIndex },
  });

  // The LLM already wrote the prose for a route it looked up with get_route, so
  // draw ONLY the card (no second narration, no logTurn — the AI turn is already
  // logged). Failure is silent: a good text answer is never replaced by an error.
  const renderAiRoute = async (action, myEpoch) => {
    try {
      const { origin, dest } = action;
      const result = await getRoutesWithRain(origin, dest, Date.now());
      if (isStaleTurn(myEpoch)) return;
      lastIntent.current = {
        type: 'route',
        nav: { destText: dest.name, isUrl: false },
        origin,
        dest,
      };
      lastCard.current = { ...routeCard(origin, dest, result).data, shownAt: Date.now() };
      say('assistant', '', routeCard(origin, dest, result), myEpoch);
    } catch {
      /* keep the text answer */
    }
  };

  // Resolve a picked/pasted destination into an actual routed answer.
  const runRoute = async (nav, originLoc, destLoc, meta = {}) => {
    const { handler = 'route', rawText = nav.destText, epoch: myEpoch = epoch.current } = meta;
    const sayAssistant = (text, extra) => say('assistant', text, extra, myEpoch);
    const startedAt = Date.now();
    const departAt = nav.departAt || Date.now();
    let result;
    try {
      result = await getRoutesWithRain(originLoc, destLoc, departAt);
    } catch (err) {
      sayAssistant(
        err.code === 'no_route'
          ? `I couldn't find a driving route from **${originLoc.name}** to **${destLoc.name}** — they don't look connected by road. If I picked the wrong “${nav.destText}”, try adding the city.`
          : `I couldn't fetch driving directions right now (${err.message}).`
      );
      logTurn({
        handler,
        message: rawText,
        parsed: { origin: originLoc.name, destination: destLoc.name },
        outcome: 'route_failed',
        city: originLoc.name,
        latency_ms: Date.now() - startedAt,
      });
      return;
    }

    const best = result.routes[result.bestIndex];
    const summary = routeSummary(destLoc.name, best.rain.level, nav.departAt);

    if (!isStaleTurn(myEpoch)) {
      lastIntent.current = { type: 'route', nav, origin: originLoc, dest: destLoc };
      lastCard.current = { origin: originLoc, dest: destLoc, routes: result.routes, bestIndex: result.bestIndex, shownAt: Date.now() };
    }
    sayAssistant(summary, routeCard(originLoc, destLoc, result));
    logTurn({
      handler,
      message: rawText,
      parsed: { origin: originLoc.name, destination: destLoc.name },
      outcome: 'ok',
      city: destLoc.name,
      latency_ms: Date.now() - startedAt,
    });
  };

  // User tapped one of the candidates. Lock the list to the choice so the picker
  // reads as a settled answer, then route to it.
  const handlePick = async (msg, choice) => {
    if (busy) return;
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, data: { ...m.data, chosen: choice } } : m)));
    pending.current = null; // this question is answered
    const myEpoch = epoch.current;
    setBusy(true);
    try {
      await runRoute(msg.data.nav, msg.data.origin, choice, { handler: 'route', rawText: msg.data.nav.destText, epoch: myEpoch });
    } finally {
      // Cleared mid-turn: clearConversation already released busy, and a newer turn
      // may own busy by now — don't clobber it.
      if (myEpoch === epoch.current) {
        setBusy(false);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    // Captured before anything else: this turn's identity for every guarded write.
    const myEpoch = epoch.current;
    const sayAssistant = (reply, extra) => say('assistant', reply, extra, myEpoch);
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
      logTurn({ handler: 'reminder', message: text, parsed: { label: reminder.label }, outcome: 'ok' });
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
          sayAssistant(
            "I couldn't read a location out of that link. Open it in Google Maps, then copy the URL from the address bar — the one with coordinates in it."
          );
          logTurn({
            handler: 'route',
            message: text,
            parsed: { destination: p.nav.destText },
            outcome: 'geocode_failed',
            city: p.originLoc.name,
          });
          return;
        }
        return await runRoute(p.nav, p.originLoc, pin, { handler: 'route', rawText: text, epoch: myEpoch });
      }

      // Rich, action-backed intents render cards/maps.
      const nav = parseNavigation(text);
      if (nav) return await handleNavigation(nav, { handler: 'route', rawText: text, epoch: myEpoch });

      const place = parseWeatherIn(text);
      if (place) return await handleWeatherIn(place, { handler: 'weather-in', rawText: text, epoch: myEpoch });

      // "What about Central Park?" / "how about at 8pm?" — re-ask the previous
      // question with just that part swapped.
      const fu = parseFollowUp(text);
      const last = lastIntent.current;
      if (fu && last) {
        if (fu.place) {
          if (last.type === 'route') {
            return await handleNavigation(
              {
                ...last.nav,
                destText: fu.place,
                isUrl: false,
                departAt: fu.departAt ?? last.nav.departAt,
              },
              { handler: 'follow-up', rawText: text, epoch: myEpoch }
            );
          }
          return await handleWeatherIn(fu.place, { handler: 'follow-up', rawText: text, epoch: myEpoch });
        }
        if (fu.departAt && last.type === 'route') {
          return await runRoute(
            { ...last.nav, departAt: fu.departAt },
            last.origin,
            last.dest,
            { handler: 'follow-up', rawText: text, epoch: myEpoch }
          );
        }
      }

      // Everything else → Gemini (AetherAI), grounded with weather context.
      // Falls back to the local assistant if the AI backend/key is unavailable.
      const startedAt = Date.now();
      try {
        const history = messagesRef.current
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, text: m.text }));
        history.push({ role: 'user', text });
        const out = await askAI(history, aiContext());
        setStatus('online'); // a real reply just came back — definitely up
        sayAssistant(out.reply);
        logTurn({
          handler: 'ai',
          message: text,
          outcome: 'ok',
          provider: out.provider,
          latency_ms: Date.now() - startedAt,
        });
        const routeAction = Array.isArray(out.actions) && out.actions.find((a) => a && a.kind === 'route');
        if (routeAction) await renderAiRoute(routeAction, myEpoch);
      } catch {
        sayAssistant(answer(text, weatherRef.current, reminders, hourlyRef.current, forecastRef.current));
        logTurn({ handler: 'fallback', message: text, outcome: 'ai_error', latency_ms: Date.now() - startedAt });
      }
    } finally {
      // Cleared mid-turn: clearConversation already released busy, and a newer turn
      // may own busy by now — don't clobber it.
      if (myEpoch === epoch.current) {
        setBusy(false);
      }
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
              {/* Live status — click to re-probe (useful when it's Offline). */}
              <button
                onClick={probe}
                title="Check connection"
                className="mt-0.5 flex items-center gap-1.5 text-[11px] transition-opacity hover:opacity-80"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${meta.pulse ? 'animate-pulse' : ''}`} />
                <span className={`font-medium ${meta.tone}`}>{meta.label}</span>
                {weather && <span className="truncate text-ink/40">· {weather.city} {weather.temp}°</span>}
                {(status === 'offline' || status === 'basic') && <RotateCw size={10} className="text-ink/40" />}
              </button>
            </div>
            {activeCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-ink/10 px-2.5 py-1 text-[11px] text-ink/70">
                <Bell size={12} /> {activeCount}
              </span>
            )}
            {/* The transcript now persists to disk, so give a way to delete it. Deliberately NOT
                disabled while `busy`: a stalled turn would leave the only delete control dead. The
                epoch/turnEpoch guard in say() is what makes clearing mid-turn safe (a late reply is
                dropped), not a disabled attribute — don't re-add one. */}
            <button
              onClick={clearConversation}
              aria-label="Clear chat"
              title="Clear chat"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/55 transition-colors hover:bg-ink/10 hover:text-ink"
            >
              <Trash2 size={16} />
            </button>
            {/* On phones the sheet covers the floating toggle — close lives here. */}
            <button
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/55 transition-colors hover:bg-ink/10 hover:text-ink sm:hidden"
            >
              <X size={18} />
            </button>
          </div>

          {/* When the LLM isn't available, say why and what to do — this is the
              thing that was impossible to diagnose on Vercel before. */}
          {STATUS_NOTE[status] && (
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
