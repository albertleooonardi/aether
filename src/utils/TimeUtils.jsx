export const getTimeOfDay = (weather) => {
  if (!weather) return 'day';
  const date = new Date(weather.timestamp * 1000);
  const hour = date.getHours();
  if (hour >= 5 && hour < 7) return 'sunrise';
  if (hour >= 18 && hour < 20) return 'sunset';
  if (hour >= 20 || hour < 5) return 'night';
  return 'day';
};

// Formats WeatherAPI's `location.localtime` string ("YYYY-MM-DD HH:MM")
// into a friendly clock + date in the city's own local time.
export const formatLocalTime = (localtime) => {
  if (!localtime) return { time: '', date: '' };
  const [datePart, timePart] = localtime.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = (timePart || '00:00').split(':').map(Number);
  const d = new Date(year, month - 1, day, hour, minute);

  return {
    time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    date: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
  };
};

// Formats a WeatherAPI hourly `time` string ("YYYY-MM-DD HH:MM") into "3 PM"
// using the city's own local hour (avoids browser-timezone drift).
export const formatHour = (timeStr) => {
  if (!timeStr) return '';
  const hh = parseInt(timeStr.split(' ')[1].split(':')[0], 10);
  const period = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12} ${period}`;
};
