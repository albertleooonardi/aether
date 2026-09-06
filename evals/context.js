/*
 * A fixed APP WEATHER DATA context, same shape ChatWidget's aiContext() builds.
 * Frozen so eval runs are comparable: the only thing that varies between runs is
 * the prompt (and the history window), never the weather.
 *
 * Surabaya is deliberately the LOADED city. Several cases ask about somewhere
 * else and then say "here" — if the model has lost the thread it answers with
 * the wrong one, which is exactly what we're measuring.
 */
module.exports = {
  location: {
    city: 'Surabaya',
    region: 'East Java',
    country: 'Indonesia',
    lat: -7.2575,
    lon: 112.7508,
    localtime: '2026-09-06 14:00',
    temp_c: 32,
    feels_like_c: 38,
    condition: 'Partly cloudy',
    today_high_c: 34,
    today_low_c: 26,
    chance_of_rain_pct: 15,
    humidity_pct: 74,
    dewpoint_c: 26,
    wind_kph: 11,
    wind_dir: 'NE',
    gust_kph: 18,
    pressure_mb: 1009,
    visibility_km: 10,
    cloud_pct: 40,
    uv_index: 9,
    uv_max_today: 11,
    is_day: true,
    sunrise: '05:22 AM',
    sunset: '05:31 PM',
    aqi_us_epa: 2,
  },
  hourly_next_hours: [
    { time: '2026-09-06 15:00', temp_c: 33, condition: 'Partly cloudy', chance_of_rain_pct: 12 },
    { time: '2026-09-06 16:00', temp_c: 32, condition: 'Partly cloudy', chance_of_rain_pct: 15 },
    { time: '2026-09-06 17:00', temp_c: 31, condition: 'Cloudy', chance_of_rain_pct: 25 },
    { time: '2026-09-06 18:00', temp_c: 29, condition: 'Light rain', chance_of_rain_pct: 62 },
    { time: '2026-09-06 19:00', temp_c: 28, condition: 'Light rain', chance_of_rain_pct: 71 },
    { time: '2026-09-06 20:00', temp_c: 28, condition: 'Cloudy', chance_of_rain_pct: 40 },
    { time: '2026-09-06 21:00', temp_c: 27, condition: 'Clear', chance_of_rain_pct: 10 },
  ],
  forecast_days: [
    { date: '2026-09-07', high_c: 33, low_c: 25, condition: 'Patchy rain', chance_of_rain_pct: 55 },
    { date: '2026-09-08', high_c: 34, low_c: 26, condition: 'Sunny', chance_of_rain_pct: 5 },
  ],
};
