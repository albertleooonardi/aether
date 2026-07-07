import React from 'react';
import { CloudSun } from 'lucide-react';

const Header = () => (
  <header className="mb-5 flex flex-col items-center text-center">
    <div className="flex items-center gap-3">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl glass">
        <CloudSun size={24} strokeWidth={1.5} className="text-white drop-glow" />
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-white text-glow md:text-4xl">
        Vrijeme
      </h1>
    </div>
    <p className="mt-1.5 text-xs font-light text-white/60 md:text-sm">
      Elegant weather, wherever you are
    </p>
  </header>
);

export default Header;
