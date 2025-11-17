import React from 'react';
import { getWeatherIcon } from '../utils/WeatherIcons';
import WeatherStats from './WeatherStats';

const WeatherCard = ({ weather, textColor, isDark }) => {
  return (
    <div className={`${isDark ? 'bg-gray-800' : 'bg-white'} border-2 ${isDark ? 'border-gray-700' : 'border-gray-300'} rounded-2xl p-8 shadow-xl`}>
      <div className="text-center mb-6">
        <h2 className={`text-3xl font-bold ${textColor} mb-1`}>
          {weather.city}, {weather.country}
        </h2>
        <p className={`${isDark ? 'text-gray-400' : 'text-gray-600'} capitalize`}>{weather.description}</p>
      </div>

      <div className="flex items-center justify-center mb-8">
        <div className="flex items-center gap-4">
          {getWeatherIcon(weather.icon, 80)}
          <div>
            <div className={`text-7xl font-bold ${textColor}`}>{weather.temp}°</div>
            <div className={`${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Feels like {weather.feels_like}°</div>
          </div>
        </div>
      </div>

      <WeatherStats weather={weather} textColor={textColor} isDark={isDark} />
    </div>
  );
};

export default WeatherCard;