import { getTimeOfDay } from './TimeUtils';

export const getBackgroundColor = (weather) => {
  if (!weather) return 'bg-gray-100';
  const timeOfDay = getTimeOfDay(weather);
  
  if (timeOfDay === 'night') return 'bg-gray-900';
  if (timeOfDay === 'sunrise' || timeOfDay === 'sunset') return 'bg-gradient-to-b from-orange-100 to-gray-100';
  
  const text = weather.icon.toLowerCase();
  
  if (text.includes('rain') || text.includes('drizzle')) {
    return 'bg-gray-300';
  }
  if (text.includes('cloud') || text.includes('overcast')) {
    return 'bg-gray-200';
  }
  if (text.includes('snow') || text.includes('blizzard') || text.includes('sleet')) {
    return 'bg-gray-100';
  }
  if (text.includes('sunny') || text.includes('clear')) {
    return 'bg-white';
  }
  
  return 'bg-gray-100';
};

export const getTextColor = (weather) => {
  if (!weather) return 'text-gray-900';
  const timeOfDay = getTimeOfDay(weather);
  return timeOfDay === 'night' ? 'text-white' : 'text-gray-900';
};