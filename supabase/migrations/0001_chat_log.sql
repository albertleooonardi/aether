-- chat_log — one row per chat turn, recording WHICH handler answered it.
--
-- Purpose is debugging the intent parser, not training data: the queries that
-- matter are `handler = 'fallback'` (the regexes missed and the LLM took it)
-- and `outcome = 'geocode_failed'` (the regexes claimed a message they should
-- not have). Those two are the standing bug report — every defect in
-- docs/chatbot-test-report.md is one of them.
--
-- Deliberately NOT stored: user identity, coordinates, assistant reply text.
-- Weather chat is movement data (where someone is, where they're going, when
-- they're leaving), so `city` is a city name at most and session_id is random
-- per session, not a person.

create table if not exists chat_log (
  id          bigserial primary key,
  ts          timestamptz not null default now(),
  session_id  text,        -- random per browser session; not a user id
  message     text,        -- user text, truncated to 2000 chars by the writer
  handler     text,        -- reminder|route|weather-in|follow-up|ai|fallback
  parsed      jsonb,       -- what the parser extracted; coordinates stripped
  outcome     text,        -- ok|geocode_failed|ai_error
  city        text,        -- city NAME only, never lat/lon
  provider    text,        -- gemini|groq|local
  latency_ms  int
);

create index if not exists chat_log_handler_ts_idx on chat_log (handler, ts desc);
create index if not exists chat_log_ts_idx on chat_log (ts desc);

-- RLS on with NO policies: the anon key cannot read or write this table even if
-- it leaks. Only the service_role key (server-side, in /api/log) reaches it.
alter table chat_log enable row level security;

-- 90-day retention. Requires pg_cron (Database → Extensions → enable pg_cron).
-- Comment this out if you'd rather prune manually.
-- select cron.schedule(
--   'chat_log_retention', '0 3 * * *',
--   $$delete from chat_log where ts < now() - interval '90 days'$$
-- );
