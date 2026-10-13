import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import SearchBar from './SearchBar';

const Harness = (props) => {
  const [city, setCity] = useState('');
  return (
    <SearchBar
      city={city}
      setCity={setCity}
      onSearch={props.onSearch || (() => {})}
      onPickPlace={props.onPickPlace || (() => {})}
      onLocate={props.onLocate || (() => {})}
      loading={false}
      locating={false}
      near={{ lat: -6.2088, lon: 106.8456 }}
    />
  );
};

beforeEach(() => localStorage.clear());

test('focus shows recommendations: your location and nearby cities', () => {
  render(<Harness />);
  fireEvent.focus(screen.getByRole('combobox', { name: /search for a city/i }));
  const menu = screen.getByRole('listbox');
  expect(within(menu).getByText('Your location')).toBeInTheDocument();
  expect(within(menu).getByRole('group', { name: 'Nearby' })).toBeInTheDocument();
  expect(within(menu).getByText('Jakarta')).toBeInTheDocument();
});

test('recent places are offered first and can be removed', () => {
  localStorage.setItem(
    'aether.recentPlaces.v1',
    JSON.stringify([{ name: 'Bogor', label: 'Bogor, Indonesia', lat: -6.5971, lon: 106.806 }])
  );
  render(<Harness />);
  fireEvent.focus(screen.getByRole('combobox'));
  const recent = screen.getByRole('group', { name: 'Recent' });
  expect(within(recent).getByText('Bogor')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /remove bogor/i }));
  expect(screen.queryByRole('group', { name: 'Recent' })).not.toBeInTheDocument();
});

test('typing filters instantly and arrow + enter picks by coordinates', () => {
  const onPickPlace = jest.fn();
  const onSearch = jest.fn();
  render(<Harness onPickPlace={onPickPlace} onSearch={onSearch} />);
  const input = screen.getByRole('combobox');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'sura' } });
  expect(within(screen.getByRole('listbox')).getByRole('option', { name: /surabaya/i })).toBeInTheDocument();

  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onPickPlace).toHaveBeenCalledWith(expect.objectContaining({ name: 'Surabaya', lat: -7.2575 }));
  expect(onSearch).not.toHaveBeenCalled();
  expect(input).toHaveValue('Surabaya');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

test('enter without a highlighted row runs a normal search; escape closes', () => {
  const onSearch = jest.fn();
  render(<Harness onSearch={onSearch} />);
  const input = screen.getByRole('combobox');
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: 'Zagreb' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSearch).toHaveBeenCalled();
});

test('the locate recommendation calls onLocate', () => {
  const onLocate = jest.fn();
  render(<Harness onLocate={onLocate} />);
  fireEvent.focus(screen.getByRole('combobox'));
  fireEvent.click(screen.getByText('Your location'));
  expect(onLocate).toHaveBeenCalled();
});

test('quick picks are visible without focusing and pick in one tap', () => {
  const onPickPlace = jest.fn();
  render(<Harness onPickPlace={onPickPlace} />);
  // The page is showing Jakarta (near), so Jakarta itself is not offered.
  expect(screen.queryByRole('button', { name: /^jakarta/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^bekasi/i }));
  expect(onPickPlace).toHaveBeenCalledWith(expect.objectContaining({ name: 'Bekasi' }));
});
