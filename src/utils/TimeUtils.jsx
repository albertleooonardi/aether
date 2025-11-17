export const getTimeOfDay = (weather) => {
  if (!weather) return 'day';
  const date = new Date(weather.timestamp * 1000);
  const hour = date.getHours();
  if (hour >= 5 && hour < 7) return 'sunrise';
  if (hour >= 18 && hour < 20) return 'sunset';
  if (hour >= 20 || hour < 5) return 'night';
  return 'day';
};