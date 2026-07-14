import { parseNavigation } from './intents';

// "into"/"towards" used to miss the parser entirely — \bto\b never matches inside
// "into" — so these fell through to a generic "I can help with rain…" reply.
test.each([
  ['Can you analyze my route from my place into Maspion Plaza', null, 'Maspion Plaza'],
  ['Route from my place into Maspion Plaza', null, 'Maspion Plaza'],
  ['route from Jakarta into Bandung', 'Jakarta', 'Bandung'],
  ['directions towards Grand Indonesia', null, 'Grand Indonesia'],
  ['drive toward Surabaya', null, 'Surabaya'],
])('parses %j', (text, origin, dest) => {
  expect(parseNavigation(text)).toMatchObject({ originText: origin, destText: dest });
});

// Existing phrasings must keep working.
test.each([
  ['route from Jakarta to Bandung', 'Jakarta', 'Bandung'],
  ['directions to Grand Indonesia', null, 'Grand Indonesia'],
  ['from my place to Grand Indonesia will it rain', null, 'Grand Indonesia'],
])('still parses %j', (text, origin, dest) => {
  expect(parseNavigation(text)).toMatchObject({ originText: origin, destText: dest });
});

test('"towards" is not shadowed by the shorter "to"', () => {
  expect(parseNavigation('route from Jakarta towards Bandung')).toMatchObject({
    originText: 'Jakarta',
    destText: 'Bandung',
  });
});

test('non-navigation messages are still ignored', () => {
  expect(parseNavigation('what is the weather in Tokyo')).toBeNull();
  expect(parseNavigation('remind me to close the windows at 6pm')).toBeNull();
});

test('rain intent is detected', () => {
  expect(parseNavigation('route from here into Bandung, will it rain?')).toMatchObject({ asksRain: true });
});
