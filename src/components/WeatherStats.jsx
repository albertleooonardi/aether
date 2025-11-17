import React from 'react';
import { Droplets, Wind, Gauge, Eye } from 'lucide-react';

const WeatherStats = ({ weather, textColor, isDark }) => {
  const stats = [
    { icon: Droplets, label: 'Humidity', value: `${weather.humidity}%` },
    { icon: Wind, label: 'Wind Speed', value: `${weather.wind} m/s` },
    { icon: Gauge, label: 'Pressure', value: `${weather.pressure} hPa` },
    { icon: Eye, label: 'Visibility', value: `${weather.visibility} km` }
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((stat, idx) => (
        <div key={idx} className={`${isDark ? 'bg-gray-700' : 'bg-gray-100'} rounded-lg p-4 text-center`}>
          <stat.icon className={`mx-auto mb-2 ${textColor}`} size={24} />
          <div className={`${isDark ? 'text-gray-400' : 'text-gray-600'} text-sm`}>{stat.label}</div>
          <div className={`${textColor} font-semibold text-lg`}>{stat.value}</div>
        </div>
      ))}
    </div>
  );
};

export default WeatherStats;