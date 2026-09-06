/*
 * Context-retention eval cases for the AetherAI chatbot.
 *
 * GOAL UNDER TEST: the chatbot must not lose the thread of a conversation about
 * this weather app. Every case is multi-turn; only the LAST reply is graded, and
 * every last turn is deliberately UNANSWERABLE without something established in
 * an earlier turn ("there", "that", "the one I mentioned", a stated preference).
 * A model that has lost context can still produce a fluent, plausible reply — it
 * just answers about the wrong city, or ignores what the user told it. That is
 * precisely the failure we are grading, so the rubric asks about the SUBSTANCE,
 * never the wording.
 *
 * `distance` = how many messages back the needed fact sits, counting the graded
 * turn. Cases at distance > 6 are outside the server's HISTORY_TURNS window and
 * are expected to fail until that window changes — they are the control group
 * that tells prompt problems apart from truncation problems.
 */
module.exports = [
  {
    id: 'carryover-city',
    category: 'entity carry-over',
    distance: 3,
    turns: [
      "What's the weather in Bandung right now?",
      'Will it rain there tomorrow?',
    ],
    rubric:
      'The reply must be about BANDUNG (the city named in turn 1), not Surabaya. It must address tomorrow/rain. Mentioning Surabaya at all, or answering with Surabaya numbers, is a failure.',
  },
  {
    id: 'here-means-loaded-city',
    category: 'deixis vs loaded city',
    distance: 3,
    turns: [
      "What's the weather in Tokyo?",
      'And here?',
    ],
    rubric:
      '"Here" must mean SURABAYA — the city loaded in the app per APP WEATHER DATA — not Tokyo. A reply that gives Tokyo conditions again, or that asks the user where "here" is, is a failure.',
  },
  {
    id: 'preference-memory',
    category: 'stated preference',
    distance: 5,
    turns: [
      'I really hate getting wet and I never carry an umbrella.',
      "What's the UV like today?",
      'Should I walk to the office around 6pm?',
    ],
    rubric:
      'The reply must reflect the stated aversion to rain/umbrellas from turn 1 — e.g. warn about the ~62-71% rain at 6-7pm, suggest leaving earlier, or note they will get wet without an umbrella. A reply that cheerfully says "take an umbrella" ignores what the user said, and a reply that ignores the rain entirely is a failure.',
  },
  {
    id: 'timeframe-extension',
    category: 'time reference carry-over',
    distance: 3,
    turns: [
      'Will it rain tomorrow?',
      'What about the day after?',
    ],
    rubric:
      'The reply must be about the day AFTER tomorrow (2026-09-08, forecast: sunny, ~5% rain), continuing the rain question from turn 1. Re-answering tomorrow, or asking what the user means, is a failure.',
  },
  {
    id: 'two-city-comparison',
    category: 'multi-entity',
    distance: 5,
    turns: [
      'How warm is it in Jakarta?',
      'And in Medan?',
      'Which of those two is warmer right now?',
    ],
    rubric:
      'The reply must compare JAKARTA and MEDAN specifically — the two cities from turns 1 and 2 — and name which is warmer. Comparing the wrong cities, introducing Surabaya as one of "those two", or asking which cities the user means, is a failure.',
  },
  {
    id: 'plan-continuity',
    category: 'user plan retention',
    distance: 5,
    turns: [
      "I'm planning an outdoor picnic here this evening around 6.",
      'How hot is it right now?',
      'What should I bring?',
    ],
    rubric:
      'The reply must connect to the PICNIC at 6pm established in turn 1 — the ~62-71% chance of light rain at 6-7pm is the decisive fact and should be raised (umbrella, shelter, or moving the plan). A generic packing list with no reference to the picnic or that evening rain is a failure.',
  },
  {
    id: 'anaphora-numeric',
    category: 'referring to a prior value',
    distance: 3,
    turns: [
      "What's the temperature right now?",
      'Is that hot for a tropical city, or pretty normal?',
    ],
    rubric:
      '"That" must refer to the temperature given in the previous reply (~32°C in Surabaya). The reply must engage with that specific value. Asking "which temperature?" or switching to a different place is a failure.',
  },
  {
    id: 'correction-memory',
    category: 'user correction',
    distance: 5,
    turns: [
      "What's the weather in Malang?",
      "Sorry, I meant to ask about the forecast, not right now — and I'm going there Tuesday.",
      'So should I pack a raincoat?',
    ],
    rubric:
      'The reply must be about MALANG and about the upcoming trip/forecast (not current Surabaya conditions), reflecting the correction in turn 2. Answering about Surabaya, or about current conditions only, is a failure.',
  },
  {
    id: 'longrange-city',
    category: 'long-range recall (beyond history window)',
    distance: 9,
    turns: [
      "I'm thinking about a trip to Yogyakarta.",
      "What's the UV index here today?",
      'And the humidity?',
      'Is the air quality okay?',
      'Is it hotter there than here right now?',
    ],
    rubric:
      '"There" must mean YOGYAKARTA, named in turn 1, compared against Surabaya. A reply that asks where "there" is, or that compares the wrong places, is a failure. NOTE: turn 1 sits outside the configured history window, so failure here indicates truncation rather than a prompt defect.',
  },
  {
    id: 'longrange-constraint',
    category: 'long-range recall (beyond history window)',
    distance: 9,
    turns: [
      'Quick note: I cycle everywhere, I have no car at all.',
      "What's the wind doing?",
      'And the sunset time?',
      'How is the visibility?',
      "What's the best way for me to get across town at 6pm?",
    ],
    rubric:
      'The reply must respect that the user CYCLES and has no car (turn 1) — advice about driving is a failure. It should ideally connect cycling to the ~62-71% rain at 6-7pm. NOTE: turn 1 sits outside the configured history window, so failure here indicates truncation rather than a prompt defect.',
  },
];
