import React from 'react';
import { AlertCircle } from 'lucide-react';

const ErrorMessage = ({ message, hint = 'Check the spelling or pick one of the suggestions.' }) => (
  <div role="alert" className="mt-5 flex max-w-2xl items-start gap-3 text-sm animate-fade-in">
    <AlertCircle size={16} className="mt-0.5 shrink-0 text-rose-300" />
    <p className="text-ink/70">
      <span className="font-medium text-ink">{String(message).replace(/\.$/, '')}.</span>
      {hint && ` ${hint}`}
    </p>
  </div>
);

export default ErrorMessage;
