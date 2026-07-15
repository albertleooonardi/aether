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

  let label = text
    .replace(/remind me( to)?/i, '')
    .replace(/\bin\s+\d+\s*(minutes?|mins?|hours?|hrs?|h)\b/i, '')
    .replace(/\bat\s+\d{1,2}(:\d{2})?\s*(am|pm)?/i, '')
    .replace(/^\s*to\s+/i, '')
    .trim();
  if (!label) label = 'your reminder';

  return { dueEpoch: due, label };
};

export const formatClock = (epoch) =>
  new Date(epoch).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

// Deterministic answer for weather questions + reminder listing.
export const answer = (text, weather, reminders = []) => {
  const t = text.toLowerCase().trim();

  if (/^(hi|hey|hello|yo)\b/.test(t)) {
    return weather
      ? `Hi! It's ${weather.temp}° and ${weather.description.toLowerCase()} in ${weather.city}. Ask me about rain, wind, UV — or say "remind me to take an umbrella at 5pm".`
      : 'Hi! Search for a city first and I can answer questions about its weather.';
  }

  if (t.includes('reminder') || t.includes('my reminders') || t.includes('list')) {
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
    if (weather.temp >= 32) notes.push(`${weather.temp}° heat`);
    if (weather.humidity >= 80) notes.push(`${weather.humidity}% humidity`);
    if (weather.isDay === 1 && weather.uv >= 8) notes.push(`a UV index of ${weather.uv}`);

    const lead = `It's ${weather.temp}° and ${weather.description.toLowerCase()} in ${weather.city}, feels like ${weather.feels_like}°`;
    if (!notes.length) return `${lead} — good conditions for it.`;
    const list = notes.length === 1 ? notes[0] : `${notes.slice(0, -1).join(', ')} and ${notes[notes.length - 1]}`;
    return `${lead}. Worth knowing: ${list}.`;
  }

  if (t.includes('rain') || t.includes('umbrella') || t.includes('wet')) {
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
  if (t.includes('uv') || t.includes('sun')) {
    return `The UV index is ${weather.uv}. ${weather.uv >= 6 ? 'High — wear sunscreen.' : 'Moderate to low.'}`;
  }
  if (t.includes('forecast') || t.includes('tomorrow') || t.includes('today')) {
    return `Today in ${weather.city}: ${weather.description.toLowerCase()}, ${weather.todayLow}°–${weather.todayHigh}°, ${weather.chanceOfRain}% chance of rain.`;
  }

  return 'I can help with rain, temperature, wind, humidity, UV, and the forecast — or set a reminder like "remind me to close the windows at 6pm".';
};
