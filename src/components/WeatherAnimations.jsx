import React from 'react';

const WeatherAnimations = ({ weather }) => {
  if (!weather) return null;

  const isNight = weather.isDay === 0;
  const text = weather.icon.toLowerCase();
  
  // Determine rain intensity
  const getRainIntensity = () => {
    if (text.includes('heavy rain') || text.includes('torrential')) return 'heavy';
    if (text.includes('moderate rain')) return 'moderate';
    if (text.includes('light rain') || text.includes('drizzle') || text.includes('patchy rain')) return 'light';
    if (text.includes('rain')) return 'moderate';
    return 'light';
  };

  const RainAnimation = () => {
    const intensity = getRainIntensity();
    let dropCount = 30;
    let animationSpeed = 0.8;
    let opacity = 0.4;

    if (intensity === 'heavy') {
      dropCount = 100;
      animationSpeed = 0.5;
      opacity = 0.6;
    } else if (intensity === 'moderate') {
      dropCount = 60;
      animationSpeed = 0.7;
      opacity = 0.5;
    } else {
      dropCount = 30;
      animationSpeed = 1;
      opacity = 0.3;
    }

    return (
      <div className="wx-fx fixed inset-0 pointer-events-none overflow-hidden z-0">
        {[...Array(dropCount)].map((_, i) => {
          const left = Math.random() * 100;
          const delay = Math.random() * 2;
          const duration = animationSpeed + Math.random() * 0.3;
          const height = 15 + Math.random() * 15;

          return (
            <div
              key={`rain-${i}`}
              className="absolute bg-gradient-to-b from-blue-300/80 via-blue-400/60 to-transparent"
              style={{
                left: `${left}%`,
                width: '2px',
                height: `${height}px`,
                animationDelay: `${delay}s`,
                animationDuration: `${duration}s`,
                opacity: opacity,
                animation: 'rainFall linear infinite',
                top: '-20px'
              }}
            />
          );
        })}
      </div>
    );
  };

  const SnowAnimation = () => (
    <div className="wx-fx fixed inset-0 pointer-events-none overflow-hidden z-0">
      {[...Array(50)].map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 5;
        const duration = 8 + Math.random() * 4;
        const size = 3 + Math.random() * 4;
        const drift = -20 + Math.random() * 40;

        return (
          <div
            key={`snow-${i}`}
            className="absolute bg-ink rounded-full"
            style={{
              left: `${left}%`,
              width: `${size}px`,
              height: `${size}px`,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
              opacity: 0.8,
              animation: 'snowFall linear infinite',
              '--drift': `${drift}px`,
              top: '-10px'
            }}
          />
        );
      })}
    </div>
  );

  const CloudAnimation = () => (
    <div className="wx-fx fixed inset-0 pointer-events-none overflow-hidden opacity-20 z-0">
      {[...Array(5)].map((_, i) => {
        const top = 10 + Math.random() * 40;
        const delay = i * 4;
        const duration = 25 + Math.random() * 10;
        const size = 100 + Math.random() * 100;

        return (
          <div
            key={`cloud-${i}`}
            className="absolute bg-gray-400 rounded-full blur-2xl"
            style={{
              top: `${top}%`,
              width: `${size}px`,
              height: `${size / 2}px`,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
              animation: 'cloudMove linear infinite',
              left: '-200px'
            }}
          />
        );
      })}
    </div>
  );

  const StarsAnimation = () => (
    <div className="wx-fx fixed inset-0 pointer-events-none overflow-hidden z-0">
      {[...Array(100)].map((_, i) => {
        const left = Math.random() * 100;
        const top = Math.random() * 100;
        const delay = Math.random() * 3;
        const duration = 2 + Math.random() * 2;
        const size = Math.random() > 0.5 ? 1 : 2;

        return (
          <div
            key={`star-${i}`}
            className="absolute bg-ink rounded-full"
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${size}px`,
              height: `${size}px`,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
              animation: 'twinkle ease-in-out infinite'
            }}
          />
        );
      })}
    </div>
  );

  // Check weather conditions
  if (text.includes('rain')) {
    return <RainAnimation />;
  }
  if (text.includes('snow') || text.includes('blizzard') || text.includes('sleet')) {
    return <SnowAnimation />;
  }
  if (text.includes('cloud') || text.includes('overcast')) {
    return <CloudAnimation />;
  }
  
  // Time-based ambience. Clear daytime and sunrise/sunset render nothing — the
  // amber sun glow was removed by request.
  if (isNight) {
    return <StarsAnimation />;
  }

  return null;
};

export default WeatherAnimations;