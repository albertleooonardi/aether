import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

test('renders the Aether shell with Weather/Map navigation', () => {
  render(<App />);
  expect(screen.getByText('AETHER')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^weather$/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^map$/i })).toBeInTheDocument();
});

test('theme toggle flips data-theme and remembers the choice', async () => {
  render(<App />);
  // jsdom reports no match for prefers-color-scheme, so the default is dark.
  expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

  await act(async () => {
    await userEvent.click(screen.getByRole('button', { name: /switch to light mode/i }));
  });

  expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  expect(localStorage.getItem('aether.theme.v1')).toBe('light');
});
