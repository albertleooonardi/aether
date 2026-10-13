import React from 'react';
import { render } from '@testing-library/react';
import WeatherAnimations, { sceneOf } from './WeatherAnimations';

const wx = (icon, isDay = 1) => ({ icon, description: icon, isDay });

test('sceneOf maps conditions to scenes', () => {
  expect(sceneOf(null)).toBe(null);
  expect(sceneOf(wx('Sunny'))).toBe('sun');
  expect(sceneOf(wx('Clear', 0))).toBe('night');
  expect(sceneOf(wx('Partly cloudy'))).toBe('partly');
  expect(sceneOf(wx('Partly cloudy', 0))).toBe('night-cloud');
  expect(sceneOf(wx('Overcast'))).toBe('cloud');
  expect(sceneOf(wx('Patchy rain nearby'))).toBe('rain-light');
  expect(sceneOf(wx('Moderate rain'))).toBe('rain');
  expect(sceneOf(wx('Heavy rain at times'))).toBe('rain-heavy');
  expect(sceneOf(wx('Thundery outbreaks possible'))).toBe('storm');
  expect(sceneOf(wx('Mist'))).toBe('fog');
  expect(sceneOf(wx('Light snow'))).toBe('snow');
});

test('every particle animation carries its own duration', () => {
  const { container } = render(<WeatherAnimations weather={wx('Moderate rain')} />);
  const animated = [...container.querySelectorAll('[style*="animation"]')];
  expect(animated.length).toBeGreaterThan(10);
  animated.forEach((node) => {
    expect(node.style.animation).toMatch(/\d(\.\d+)?s/);
    expect(node.style.animationDuration).not.toBe('0s');
  });
});

test('re-rendering with the same sky keeps every particle in place', () => {
  const { container, rerender } = render(<WeatherAnimations weather={wx('Sunny')} />);
  const before = [...container.querySelectorAll('span')].map((n) => n.getAttribute('style'));
  const firstNode = container.querySelector('span');
  // A new object with the same condition — what a re-render of the page does.
  rerender(<WeatherAnimations weather={{ ...wx('Sunny'), temp: 31 }} />);
  const after = [...container.querySelectorAll('span')].map((n) => n.getAttribute('style'));
  expect(after).toEqual(before);
  expect(container.querySelector('span')).toBe(firstNode);
});

test('a different sky switches scenes', () => {
  const { container, rerender } = render(<WeatherAnimations weather={wx('Sunny')} />);
  expect(container.querySelector('[data-scene]').dataset.scene).toBe('sun');
  rerender(<WeatherAnimations weather={wx('Light snow')} />);
  expect(container.querySelector('[data-scene]').dataset.scene).toBe('snow');
});
