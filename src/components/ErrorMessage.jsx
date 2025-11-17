import React from 'react';

const ErrorMessage = ({ message }) => (
  <div className="max-w-md mx-auto mb-8 p-4 bg-red-100 border-2 border-red-300 rounded-lg text-red-900 text-center">
    {message}
  </div>
);

export default ErrorMessage;