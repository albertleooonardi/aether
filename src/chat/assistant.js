// Lightweight deterministic assistant for the chat popup.
// (The Gemini NL layer from the PRD would replace `answer()` later; reminders
// stay client-side here.)

// "in 20 minutes" / "at 6pm" → an epoch, or null when the text names no time.
// Shared by reminders and by route departure times ("route to X at 6pm").
export const parseWhen = (text) => {
  const t = text.toLowerCase();

  const inMatch = t.match(/\bin\s+(\d+)\s*(minutes?|mins?|hours?|hrs?|h)\b/);
  if (inMatch) {
    const n = Number(inMatch[1]);
    const isHour = inMatch[2].startsWith('h');
    return Date.now() + n * (isHour ? 3600000 : 60000);
  }

  const atMatch = t.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (atMatch) {
    let h = Number(atMatch[1]);
    const m = atMatch[2] ? Number(atMatch[2]) : 0;
    const ap = atMatch[3];
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h > 23 || m > 59) return null;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); // next occurrence
    return d.getTime();
  }

  return null;
};

// Parse a "remind me …" message into { dueEpoch, label } or null if no reminder
// intent / no parseable time.
export const parseReminder = (text) => {
  const t = text.toLowerCase();
  if (!t.includes('remind')) return null;

  const due = parseWhen(text);
  if (!due) return null;

  // The label is what the notification shows, so everything that is phrasing
  // rather than content has to come off the FRONT. `remind me to` alone wasn't
  // anchored, so a polite lead-in survived it: "Can you remind me to bring an
  // umbrella at 5pm?" produced the label "Can you  bring an umbrella ?". And
  // "set a reminder to …" cleared the includes('remind') gate above while
  // matching no strip pattern at all, so the entire sentence became the label.
  let label = text
    .replace(/^\s*(?:can|could|would|will)\s+you\s+(?:please\s+)?/i, '')
    .replace(/^\s*(?:please|hey|ok(?:ay)?|yo)[,\s]+/i, '')
    .replace(/^\s*(?:set|add|create|make)\s+(?:me\s+)?(?:a|an)\s+reminder\s*(?:for|to)?\s*/i, '')
    .replace(/\bremind me( to)?/i, '')
    .replace(/\bin\s+\d+\s*(minutes?|mins?|hours?|hrs?|h)\b/i, '')
    .replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?/i, '')
    .replace(/^\s*to\s+/i, '')
    // Collapse the gap a mid-sentence strip leaves behind, and drop the trailing
    // punctuation of the original question ("… an umbrella ?").
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*[?!.,;:]+\s*$/, '')
    .trim();
  if (!label) label = 'your reminder';

  return { dueEpoch: due, label };
};

export const formatClock = (epoch) =>
  new Date(epoch).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

// The one-line prose for a route reply. The card already shows endpoints,
// distance, duration, rain status and arrival, so this carries only the verdict.
// The destination name stays because stripExtras drops the card when the
// transcript is persisted: after a refresh this line is all that survives, and a
// bare "no umbrella needed" would mean nothing. `departAt` is passed only when
// the user asked for a specific time; the card says "Arriving", never "leaving".
const ROUTE_VERDICT = {
  dry: 'stays dry the whole way, no umbrella needed.',
  light: 'a little light rain on the way, maybe pack an umbrella.',
  wet: "rain forecast while you'd be driving, take an umbrella.",
  unknown: "I couldn't check rain along this route.",
};
export const routeSummary = (destName, level, departAt) =>
  `**${destName}** — ${ROUTE_VERDICT[level] || ROUTE_VERDICT.unknown}` +
  (departAt ? ` Leaving ${formatClock(departAt)}.` : '');

// "2026-07-16 20:00" (WeatherAPI hour.time) → "8 PM".
const hourLabel = (time) => {
  const d = new Date(String(time).replace(' ', 'T'));
  return Number.isNaN(d.getTime())
    ? String(time).slice(-5)
    : d.toLocaleTimeString('en-US', { hour: 'numeric' });
};

// Deterministic answer for weather questions + reminder listing. `hourly` and
// `forecast` are the same arrays the app's own cards render, so "later" and
// "tomorrow" are answered from real data instead of today's daily number.
export const answer = (text, weather, reminders = [], hourly = [], forecast = []) => {
  const t = text.toLowerCase().trim();

  if (/^(hi|hey|hello|yo)\b/.test(t)) {
    return weather
      ? `Hi! It's ${weather.temp}° and ${weather.description.toLowerCase()} in ${weather.city}. Ask me about rain, wind, UV — or say "remind me to take an umbrella at 5pm".`
      : 'Hi! Search for a city first and I can answer questions about its weather.';
  }

  // Bare "list" is too broad — "show me the list of raining countries" used to
  // dump the reminder list. Only a message that mentions reminders is asking.
  if (/\breminders?\b/.test(t) || (t.includes('list') && t.includes('remind'))) {
    const active = reminders.filter((r) => r.dueEpoch > Date.now());
    if (!active.length) return 'You have no active reminders. Try "remind me to stretch in 30 min".';
    return (
      'Your reminders:\n' +
      active
        .sort((a, b) => a.dueEpoch - b.dueEpoch)
        .map((r) => `• ${r.label} — ${formatClock(r.dueEpoch)}`)
        .join('\n')
    );
  }

  if (!weather) return 'Search for a city in the app and I can tell you about its weather.';

  // Order matters: these are first-match-wins, so the specific questions have to
  // be tested before the broad ones. "What should I wear today?" used to be
  // answered by the `today` forecast rule, which never mentions clothes.

  // "good evening for a run?", "ok to walk?" — a verdict, not a data dump.
  // Stems, anchored only at the front, so inflections come along: run/running,
  // cycl→cycle/cycling, bik→bike/biking. A trailing \b would demand the stem be a
  // whole word and quietly miss every one of them.
  if (/\b(?:run|jog|walk|cycl|bik|hik|outside|outdoor|exercis|workout|training)/.test(t)) {
    const notes = [];
    if (weather.chanceOfRain >= 40) notes.push(`a ${weather.chanceOfRain}% chance of rain`);
    if (weather.temp >= 32 || weather.feels_like >= 35) {
      notes.push(weather.feels_like > weather.temp ? `it feels like ${weather.feels_like}°` : `${weather.temp}° heat`);
    }
    if (weather.humidity >= 80) notes.push(`${weather.humidity}% humidity`);
    if (weather.isDay === 1 && weather.uv >= 8) notes.push(`a UV index of ${weather.uv}`);
    // Exercising in smoke is worse than exercising in drizzle — call it out.
    if (weather.aqi >= 3 || /haze|smoke|smog|dust/i.test(weather.description)) {
      notes.push(`the air quality (${weather.description.toLowerCase()}) — maybe keep it short or go indoors`);
    }

    const lead = `It's ${weather.temp}° and ${weather.description.toLowerCase()} in ${weather.city}, feels like ${weather.feels_like}°`;
    if (!notes.length) return `${lead} — good conditions for it.`;
    const list = notes.length === 1 ? notes[0] : `${notes.slice(0, -1).join(', ')} and ${notes[notes.length - 1]}`;
    return `${lead}. Worth knowing: ${list}.`;
  }

  // "show me the list of raining places" needs live multi-city data, which only
  // the AI backend can fetch — answering it with the current city's number reads
  // as not understanding the question. Say what's possible instead.
  if (/\b(list|which|where)\b/.test(t) && /\b(rain|storm|wet)/.test(t) && !/\bhere\b|umbrella/.test(t)) {
    return `I can't scan multiple cities in basic mode — that needs the AI backend. I can check one place at a time: try "weather in Surabaya" or "will it rain in Jakarta".`;
  }

  // "will it rain tomorrow" must not be answered with today's number.
  if (t.includes('tomorrow') && forecast.length) {
    const d = forecast[0];
    return `Tomorrow in ${weather.city}: ${d.weather.toLowerCase()}, ${d.low}°–${d.high}°, ${d.chanceOfRain}% chance of rain.${
      d.chanceOfRain >= 40 ? ' Plan for an umbrella.' : ''
    }`;
  }

  // A raw includes('rain') also fires inside "train", "terrain" and "Ukraine", and
  // this broad rule sits above the clothing and temperature rules — so "what should
  // I wear on the train" was answered about rain. Word-boundaried, with inflections
  // (raining/rainy/rains) so nothing that used to match is lost.
  if (/\brain(?:ing|y|s)?\b/.test(t) || t.includes('umbrella') || t.includes('wet')) {
    // Hour-by-hour beats the daily number for "later"/"tonight": say when.
    if (hourly.length) {
      const rainy = hourly.find((h) => h.chanceOfRain >= 40);
      if (rainy) {
        return `Rain looks likely around ${hourLabel(rainy.time)} in ${weather.city} (${rainy.chanceOfRain}% chance, ${rainy.weather.toLowerCase()}). Worth taking an umbrella.`;
      }
      const peak = hourly.reduce((m, h) => Math.max(m, h.chanceOfRain ?? 0), 0);
      return `No rain expected in ${weather.city} for the next ${hourly.length} hours — the highest hourly chance is ${peak}% (currently ${weather.description.toLowerCase()}). You can skip the umbrella.`;
    }
    return `There's a ${weather.chanceOfRain}% chance of rain today in ${weather.city} (currently ${weather.description.toLowerCase()}). ${
      weather.chanceOfRain >= 40 ? 'Worth taking an umbrella.' : 'You can probably skip the umbrella.'
    }`;
  }
  if (t.includes('wear') || t.includes('dress') || t.includes('jacket')) {
    const base =
      weather.temp <= 12
        ? 'Bundle up — a warm jacket and layers.'
        : weather.chanceOfRain >= 40
        ? 'Take a rain jacket or umbrella just in case.'
        : weather.temp >= 31
        ? 'Light, breathable clothing — it’s hot out.'
        : 'Light, comfortable clothing should be fine.';
    return `${weather.temp}° and ${weather.description.toLowerCase()} in ${weather.city}, ${weather.todayLow}°–${weather.todayHigh}° today. ${base}`;
  }
  if (t.includes('hot') || t.includes('cold') || t.includes('temp') || t.includes('degree') || t.includes('warm')) {
    return `It's ${weather.temp}° in ${weather.city}, feels like ${weather.feels_like}°. Today's range is ${weather.todayLow}°–${weather.todayHigh}°.`;
  }
  if (t.includes('wind')) {
    return `Wind is ${Math.round(weather.wind)} km/h from the ${weather.windDir}, gusting to ${Math.round(weather.gust ?? weather.wind)} km/h.`;
  }
  if (t.includes('humid')) {
    return `Humidity is ${weather.humidity}% and the dew point is ${weather.dewpoint}°.`;
  }
  // Must sit above the UV rule: that rule's t.includes('sun') is a substring test,
  // so every sunrise/sunset question was answered with the UV index. App.js puts
  // the day's astro times on the weather object, so the answer is already in scope.
  if (/\bsun(?:rise|set)\b/.test(t) || /\bsun\s+(?:rise|set|goes down|comes up)\b/.test(t)) {
    // astro can be missing from the forecast day — App.js stores null then.
    if (!weather.sunrise || !weather.sunset) {
      return `I don't have sunrise and sunset times for ${weather.city} right now.`;
    }
    return `In ${weather.city}, sunrise is at ${weather.sunrise} and sunset at ${weather.sunset}.`;
  }
  // \bsun\b rather than includes('sun'), so "sunset"/"sunrise" fall to the rule
  // above. sunny/sunshine/sunscreen/sunburn are spelled out because they are
  // genuine UV questions and a bare \bsun\b would no longer reach them.
  if (t.includes('uv') || /\bsun(?:ny|shine|screen|burn)?\b/.test(t)) {
    // A single threshold at 6 put UV 0 in the same sentence as UV 5 — so after
    // dark, when the index is always 0, the app answered "Moderate to low".
    // There is no UV at night; say so, and otherwise use the standard WHO bands
    // rather than one cut. uvMax gives the daytime peak, which is the number
    // someone asking at night actually wants.
    if (weather.isDay === 0 || weather.uv === 0) {
      const peak = weather.uvMax ? ` Today's peak was ${weather.uvMax}.` : '';
      return `No UV right now — the sun is down.${peak}`;
    }
    const band =
      weather.uv >= 11
        ? 'Extreme — avoid the sun around midday.'
        : weather.uv >= 8
        ? 'Very high — sunscreen and shade.'
        : weather.uv >= 6
        ? 'High — wear sunscreen.'
        : weather.uv >= 3
        ? 'Moderate — sunscreen if you are out a while.'
        : 'Low — no protection needed.';
    return `The UV index is ${weather.uv}. ${band}`;
  }
  if (t.includes('forecast') || t.includes('tomorrow') || t.includes('today')) {
    return `Today in ${weather.city}: ${weather.description.toLowerCase()}, ${weather.todayLow}°–${weather.todayHigh}°, ${weather.chanceOfRain}% chance of rain.`;
  }

  return 'I can help with rain, temperature, wind, humidity, UV, and the forecast — here or anywhere ("weather in Surabaya"). Ask "any rain when I\'m going to Grand Indonesia?" and I\'ll check along the route, or set a reminder like "remind me to close the windows at 6pm".';
};
