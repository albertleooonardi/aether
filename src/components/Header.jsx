import React from 'react';

const Header = ({ textColor, isDark }) => (
  <div className="text-center mb-8">
    <h1 className={`text-4xl md:text-5xl font-bold ${textColor} mb-2`}>Vrijeme</h1>
    <p className={`${isDark ? 'text-gray-300' : 'text-gray-600'}`}>Your personal weather companion</p>
  </div>
);

export default Header;