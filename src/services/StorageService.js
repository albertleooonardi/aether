export const saveLastCity = async (cityName) => {
  try {
    localStorage.setItem('last-city', cityName);
  } catch (err) {
    console.error('Failed to save city:', err);
  }
};

export const loadLastCity = async () => {
  try {
    return localStorage.getItem('last-city');
  } catch (err) {
    console.log('No previous city saved');
    return null;
  }
};