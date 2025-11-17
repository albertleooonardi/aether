import React from 'react';

const SearchBar = ({ city, setCity, onSearch, loading, isDark }) => (
  <div className="mb-8">
    <div className="flex gap-2 max-w-md mx-auto">
      <input
        type="text"
        value={city}
        onChange={(e) => setCity(e.target.value)}
        onKeyPress={(e) => e.key === 'Enter' && onSearch()}
        placeholder="Enter city name..."
        className={`flex-1 px-4 py-3 rounded-lg border-2 ${
          isDark 
            ? 'bg-gray-800 border-gray-700 text-white placeholder-gray-400' 
            : 'bg-white border-gray-300 text-gray-900 placeholder-gray-500'
        } focus:outline-none focus:ring-2 focus:ring-gray-500`}
      />
      <button
        onClick={onSearch}
        disabled={loading}
        className={`px-6 py-3 rounded-lg font-semibold transition-all disabled:opacity-50 ${
          isDark
            ? 'bg-gray-700 text-white hover:bg-gray-600'
            : 'bg-gray-900 text-white hover:bg-gray-800'
        }`}
      >
        {loading ? 'Loading...' : 'Search'}
      </button>
    </div>
  </div>
);

export default SearchBar;