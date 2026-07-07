import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Bell, Sparkles } from 'lucide-react';
import { parseReminder, answer, formatClock } from '../../chat/assistant';

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

const ChatWidget = ({ weather, onRouteCommand }) => {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([
    {
      id: 'intro',
      role: 'assistant',
      text: "Hi! I'm your weather assistant. Ask about rain, temperature, wind or UV, set a reminder (\"remind me to take an umbrella at 5pm\"), or save a route and I'll forecast the weather along it (\"save a run route here\").",
    },
  ]);
  const [reminders, setReminders] = useState(loadReminders);
  const timers = useRef({});
  const logEnd = useRef(null);
  const weatherRef = useRef(weather);
  weatherRef.current = weather;

  const say = (role, text) =>
    setMessages((m) => [...m, { id: `${Date.now()}-${Math.random()}`, role, text }]);

  useEffect(() => {
    if (open) logEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const fireReminder = useCallback((rem) => {
    say('assistant', `⏰ Reminder: ${rem.label}`);
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Vrijeme reminder', { body: rem.label });
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
      // setTimeout caps around ~24.8 days; reminders here are short-term.
      timers.current[rem.id] = setTimeout(() => fireReminder(rem), delay);
    },
    [fireReminder]
  );

  // Reschedule persisted reminders on mount; drop any already past.
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

  const handleSubmit = (e) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    say('user', text);

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
      say('assistant', `Got it — I'll remind you to ${reminder.label} at ${formatClock(reminder.dueEpoch)}.`);
      return;
    }

    if (onRouteCommand) {
      const routeReply = onRouteCommand(text);
      if (routeReply) {
        say('assistant', routeReply);
        return;
      }
    }

    say('assistant', answer(text, weatherRef.current, reminders));
  };

  const activeCount = reminders.filter((r) => r.dueEpoch > Date.now()).length;

  return (
    <>
      {/* Floating button */}
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

      {/* Popup */}
      {open && (
        <div className="fixed bottom-24 right-5 z-50 flex h-[min(560px,75vh)] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-3xl border border-white/10 bg-neutral-900/80 shadow-2xl backdrop-blur-2xl animate-fade-in-up">
          {/* Header */}
          <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10">
              <Sparkles size={17} className="text-amber-200" />
            </span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-white">Weather Assistant</div>
              <div className="text-[11px] text-white/50">
                {weather ? `${weather.city} · ${weather.temp}°` : 'No location yet'}
              </div>
            </div>
            {activeCount > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] text-white/70">
                <Bell size={12} /> {activeCount}
              </span>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-md bg-white px-3.5 py-2 text-sm text-slate-800">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex justify-start">
                  <div className="max-w-[88%] whitespace-pre-line rounded-2xl rounded-bl-md bg-white/10 px-3.5 py-2 text-sm text-white/90">
                    {m.text}
                  </div>
                </div>
              )
            )}
            <div ref={logEnd} />
          </div>

          {/* Quick suggestions */}
          <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-2">
            {['Will it rain?', 'Save a run route here', 'Forecast my run', 'Remind me to bring an umbrella at 5pm'].map((q) => (
              <button
                key={q}
                onClick={() => setInput(q)}
                className="shrink-0 rounded-full bg-white/8 px-3 py-1.5 text-xs text-white/70 transition-colors hover:bg-white/15"
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
                placeholder="Ask or set a reminder…"
                className="w-full bg-transparent px-3 py-1.5 text-sm text-white placeholder-white/40 outline-none"
              />
              <button
                type="submit"
                aria-label="Send"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-slate-900 transition-transform active:scale-95"
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
