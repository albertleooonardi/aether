-- chat_messages — durable conversation memory for the chatbot.
--
-- Distinct from chat_log (0001), on purpose. chat_log is telemetry: no assistant
-- replies, throwaway session id, built for "which handler answered this?".
-- This table is the opposite — full conversation content, keyed to a stable
-- client so the thread survives a refresh, a closed tab, or a new browser
-- session, and so the LLM gets its context back.
--
-- PRIVACY: this holds the actual conversation, which in a weather app means
-- places the user has asked about and routes they planned. Heavier than
-- chat_log. The retention job below is not optional in spirit — set one.

create table if not exists chat_messages (
  id         bigserial primary key,
  client_id  text not null,   -- random id persisted in the browser; NOT an account
  ts         timestamptz not null default now(),
  role       text not null,   -- 'user' | 'assistant'
  text       text not null
);

create index if not exists chat_messages_client_ts_idx on chat_messages (client_id, ts);

-- RLS on with no policies: unreachable with the anon key, server-side only.
alter table chat_messages enable row level security;

-- 30 days. Shorter than chat_log's 90 because the content is more sensitive.
-- Requires pg_cron (Database → Extensions).
-- select cron.schedule(
--   'chat_messages_retention', '0 3 * * *',
--   $$delete from chat_messages where ts < now() - interval '30 days'$$
-- );
