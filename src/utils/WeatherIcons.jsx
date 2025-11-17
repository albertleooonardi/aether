import React from 'react';
import { Sun, Cloud, CloudRain, CloudSnow, CloudDrizzle, CloudFog } from 'lucide-react';

export const getWeatherIcon = (weatherText, size = 48) => {
  const iconProps = { size, strokeWidth: 1.5 };
  const text = weatherText.toLowerCase();
  
  // Clear/Sunny
  if (text.includes('sunny') || text.includes('clear')) {
    return <Sun {...iconProps} className="text-gray-900" />;
  }
  // Rain
  if (text.includes('rain') && !text.includes('drizzle')) {
    return <CloudRain {...iconProps} className="text-gray-800" />;
  }
  // Drizzle
  if (text.includes('drizzle') || text.includes('light rain')) {
    return <CloudDrizzle {...iconProps} className="text-gray-700" />;
  }
  // Snow
  if (text.includes('snow') || text.includes('blizzard') || text.includes('sleet')) {
    return <CloudSnow {...iconProps} className="text-gray-600" />;
  }
  // Fog/Mist
  if (text.includes('mist') || text.includes('fog') || text.includes('haze')) {
    return <CloudFog {...iconProps} className="text-gray-600" />;
  }
  // Cloudy (default)
  if (text.includes('cloud') || text.includes('overcast')) {
    return <Cloud {...iconProps} className="text-gray-700" />;
  }
  
  // Default
  return <Cloud {...iconProps} className="text-gray-700" />;
};