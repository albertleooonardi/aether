import React from 'react';
import { getWeatherIcon } from '../utils/WeatherIcons';

const ForecastCard = ({ forecast, textColor, isDark }) => {
  return (
    <div className={`${isDark ? 'bg-gray-800' : 'bg-white'} border-2 ${isDark ? 'border-gray-700' : 'border-gray-300'} rounded-2xl p-6 shadow-xl`}>
      <h3 className={`text-2xl font-bold ${textColor} mb-4`}>3-Day Forecast</h3>
      <div className="grid md:grid-cols-3 gap-4">
        {forecast.map((day, idx) => (
          <div key={idx} className={`${isDark ? 'bg-gray-700' : 'bg-gray-100'} rounded-lg p-4 text-center`}>
            <div className={`${textColor} font-semibold mb-2`}>
              {day.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </div>
            <div className="flex justify-center mb-3">
              {getWeatherIcon(day.weather, 40)}
            </div>
            <div className={`flex justify-center gap-4 ${textColor}`}>
              <div>
                <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>High</div>
                <div className="font-bold text-lg">{day.high}°</div>
              </div>
              <div>
                <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Low</div>
                <div className="font-bold text-lg">{day.low}°</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ForecastCard;