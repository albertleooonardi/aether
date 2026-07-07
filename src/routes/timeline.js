// Deterministic route-weather timeline: map polyline + pace onto a time axis and
// sample the hourly forecast at each segment's ETA.
import { cumulativeKm } from './geo';

const flattenHours = (forecastDays) => (forecastDays || []).flatMap((d) => d.hour || []);

export const findHourAt = (hours, epochSec) => {
  if (!hours.length) return null;
  if (epochSec <= hours[0].time_epoch) return hours[0];
  const last = hours[hours.length - 1];
  if (epochSec >= last.time_epoch + 3600) return last;
  for (let i = 0; i < hours.length; i++) {
    if (epochSec < hours[i].time_epoch + 3600) return hours[i];
  }
  return last;
};

export const classifyHour = (hour) => {
  if (!hour) return 'clear';
  const precip = hour.precip_mm ?? 0;
  const chance = hour.chance_of_rain ?? 0;
  const wind = hour.wind_kph ?? 0;
  if (precip >= 0.5 || chance >= 60) return 'rain';
  if (precip > 0 || chance >= 35) return 'light_rain';
  if (wind >= 35) return 'wind';
  return 'clear';
};

export const isWet = (c) => c === 'rain' || c === 'light_rain';

const conditionLabel = (c) =>
  ({ clear: 'clear', light_rain: 'light rain', rain: 'rain', wind: 'gusty wind' }[c] || 'clear');

export const buildTimeline = (route, startEpochSec, forecastDays) => {
  const cum = cumulativeKm(route.polyline);
  const pace = route.avgPaceMinPerKm;
  const hours = flattenHours(forecastDays);

  const segments = [];
  for (let i = 1; i < route.polyline.length; i++) {
    const startEta = cum[i - 1] * pace;
    const endEta = cum[i] * pace;
    const midEta = (startEta + endEta) / 2;
    const condition = classifyHour(findHourAt(hours, startEpochSec + midEta * 60));
    segments.push({ index: i - 1, fromKm: cum[i - 1], startEta, endEta, condition });
  }

  const totalMin = cum[cum.length - 1] * pace;
  const wetMinutes = segments.reduce(
    (acc, s) => acc + (isWet(s.condition) ? s.endEta - s.startEta : 0),
    0
  );
  return { segments, totalMin, totalKm: cum[cum.length - 1], wetMinutes };
};

// Short, TTS-friendly narration (deterministic stand-in for an LLM).
export const summarize = (timeline, route) => {
  const total = Math.round(timeline.totalMin);
  const firstWet = timeline.segments.find((s) => isWet(s.condition));
  if (!firstWet) {
    return `Clear the whole way — about ${total} min for your ${route.activityType}, no rain expected.`;
  }
  const dryFor = Math.round(firstWet.startEta);
  const wet = Math.round(timeline.wetMinutes);
  const cond = conditionLabel(firstWet.condition);
  if (dryFor <= 1) {
    return `${cond[0].toUpperCase() + cond.slice(1)} from the start near ${firstWet.fromKm.toFixed(1)} km — ~${wet} of ${total} min look wet.`;
  }
  return `Clear for the first ${dryFor} min, then ${cond} around the ${firstWet.fromKm.toFixed(1)} km mark — ~${wet} of ${total} min wet.`;
};
