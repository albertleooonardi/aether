import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the Aether shell with Weather/Map navigation', () => {
  render(<App />);
  expect(screen.getByText('AETHER')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /weather/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /map/i })).toBeInTheDocument();
});
