import React from 'react';
import { AlertCircle } from 'lucide-react';

const ErrorMessage = ({ message }) => (
  <div className="mx-auto mb-8 flex max-w-xl items-center gap-3 rounded-2xl border border-rose-300/30 bg-rose-500/15 px-4 py-3.5 text-ink backdrop-blur-xl animate-fade-in">
    <AlertCircle size={20} className="shrink-0 text-rose-200" />
    <div>
      <p className="text-sm font-medium">{message}</p>
      <p className="text-xs text-ink/60">Check the spelling or try another city.</p>
    </div>
  </div>
);

export default ErrorMessage;
