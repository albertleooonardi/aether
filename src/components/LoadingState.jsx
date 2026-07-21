import React from 'react';

const Shimmer = ({ className = '' }) => (
  // The sweep is drawn in `ink` so it stays visible in both themes — a white
  // shimmer would disappear entirely against a light placeholder.
  <div
    className={`overflow-hidden rounded-xl bg-ink/10 ${className}`}
    style={{
      backgroundImage:
        'linear-gradient(90deg, rgb(var(--ink) / 0) 0%, rgb(var(--ink) / 0.18) 50%, rgb(var(--ink) / 0) 100%)',
      backgroundSize: '500px 100%',
      backgroundRepeat: 'no-repeat',
    }}
  >
    <div className="h-full w-full animate-shimmer" />
  </div>
);

const LoadingState = () => (
  <div className="space-y-4 animate-fade-in">
    {/* Top row: hero + clock */}
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-3xl glass p-6 md:p-8 lg:col-span-2">
        <Shimmer className="h-7 w-40" />
        <Shimmer className="mt-2 h-4 w-24" />
        <div className="mt-6 flex items-center justify-between">
          <div className="space-y-3">
            <Shimmer className="h-16 w-40" />
            <Shimmer className="h-4 w-28" />
          </div>
          <Shimmer className="h-24 w-24 rounded-full" />
        </div>
        <Shimmer className="mt-6 h-12 w-full" />
      </div>
      <div className="rounded-3xl glass p-6">
        <Shimmer className="h-4 w-24" />
        <Shimmer className="my-4 h-14 w-32" />
        <div className="grid grid-cols-2 gap-3">
          <Shimmer className="h-14" />
          <Shimmer className="h-14" />
        </div>
      </div>
    </div>

    {/* Hourly strip skeleton */}
    <div className="rounded-3xl glass p-5 md:p-6">
      <Shimmer className="mb-4 h-4 w-36" />
      <div className="flex gap-2 overflow-hidden">
        {[...Array(9)].map((_, i) => (
          <Shimmer key={i} className="h-32 w-[74px] shrink-0" />
        ))}
      </div>
    </div>

    {/* Detail bento skeleton */}
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {[...Array(8)].map((_, i) => (
        <Shimmer key={i} className="h-28" />
      ))}
    </div>

    {/* Forecast skeleton */}
    <div className="rounded-3xl glass p-6 md:p-8">
      <Shimmer className="mb-5 h-5 w-36" />
      <div className="grid gap-3 sm:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <Shimmer key={i} className="h-44" />
        ))}
      </div>
    </div>
  </div>
);

export default LoadingState;
