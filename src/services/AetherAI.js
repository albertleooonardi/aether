// Talks to the AetherAI backend (server/index.js), which holds the AI keys and
// manages Gemini↔Groq failover + token usage. The backend still tracks and
// exposes that usage at GET /api/usage for diagnostics; the app no longer
// surfaces it in the UI.
// In dev, Create React App proxies /api → http://localhost:3001 (package.json "proxy").

const withTimeout = (ms) => {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
};

// One id per tab session, generated once at module load — never persisted
// (a reload is a new session) and never a user identity. It exists only so
// chat_log rows from the same conversation can be grouped.
const SESSION_ID =
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const LOG_MESSAGE_MAX = 2000;

// chat_log is a debugging aid for the intent parser, not a location history —
// lat/lon must never leave the client. Strips coordinate-shaped keys out of
// `parsed` recursively (e.g. a route's { origin: { lat, lon } }); city NAMEs
// are untouched.
const COORD_KEYS = new Set(['lat', 'lon', 'lng', 'latitude', 'longitude']);
const stripCoords = (value) => {
  if (Array.isArray(value)) return value.map(stripCoords);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !COORD_KEYS.has(k.toLowerCase()))
        .map(([k, v]) => [k, stripCoords(v)])
    );
  }
  return value;
};

// Stable per-browser id for durable chat memory (Supabase-backed, see
// api/_lib/core.js's chatMemory* handlers), generated once and persisted in
// localStorage. Deliberately NOT the SESSION_ID above — that one is ephemeral
// telemetry and must never double as an identity. This is per-browser, not an
// account: memory does not follow the user across devices, and clearing site
// data starts a fresh, unlinked id — an accepted tradeoff for not needing auth.
const CLIENT_ID_KEY = 'vrijeme.client.v1';

export const getClientId = () => {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
};

// Mirrors the server-side cap (chatMemoryWriteHandler) so an oversized
// message isn't shipped over the wire just to be truncated on arrival.
const MEMORY_TEXT_MAX = 2000;

// Fire-and-forget durable-memory write: persists one turn (role + text only —
// no card/route/choice payload) so the thread survives a closed tab or a new
// session. Never awaited by a caller and never throws — a Supabase outage or
// an unconfigured backend must behave exactly like today, not block sending
// a message or surface an error in the chat UI.
export const saveMessage = (role, text) => {
  try {
    const clientId = getClientId();
    if (!clientId || typeof text !== 'string' || !text) return;
    fetch('/api/chat-memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, role, text: text.slice(0, MEMORY_TEXT_MAX) }),
    }).catch(() => {});
  } catch {
    /* durable memory must never break chat */
  }
};

// Recent transcript for this browser's client_id, oldest-first (ready to
// replay straight into messages state / askAI history). Resolves to [] on
// any failure — no backend configured, table not created yet, network error —
// so callers treat "nothing to hydrate" and "storage is down" identically.
export const fetchMemory = async () => {
  const clientId = getClientId();
  if (!clientId) return [];
  const t = withTimeout(5000);
  try {
    const res = await fetch(`/api/chat-memory?client_id=${encodeURIComponent(clientId)}`, { signal: t.signal });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.messages) ? data.messages : [];
  } catch {
    return [];
  } finally {
    t.clear();
  }
};

// Server side of the Trash button: deletes this client_id's durable
// transcript so "clear chat" actually clears the durable copy, not just
// localStorage. Fire-and-forget, same degrade contract as saveMessage.
export const deleteMemory = () => {
  try {
    const clientId = getClientId();
    if (!clientId) return;
    fetch(`/api/chat-memory?client_id=${encodeURIComponent(clientId)}`, { method: 'DELETE' }).catch(() => {});
  } catch {
    /* durable memory must never break chat */
  }
};

// Fire-and-forget chat-turn telemetry: which handler answered and whether it
// succeeded, so `handler='fallback'` / `outcome='geocode_failed'` rows can be
// queried as a standing bug report for the intent parser. Never the reply
// text, never awaited by a caller, and its own failure (backend down, no
// Supabase configured) must never affect the chat — so this never throws and
// callers should not await it.
export const logTurn = (entry) => {
  try {
    const payload = {
      session_id: SESSION_ID,
      message: typeof entry.message === 'string' ? entry.message.slice(0, LOG_MESSAGE_MAX) : null,
      handler: entry.handler || null,
      parsed: entry.parsed ? stripCoords(entry.parsed) : null,
      outcome: entry.outcome || null,
      city: entry.city || null,
      provider: entry.provider || null,
      latency_ms: Number.isFinite(entry.latency_ms) ? entry.latency_ms : null,
    };
    fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {
    /* telemetry must never break chat */
  }
};

// Returns { reply, provider, model, usage }. Throws if the backend/keys are
// unavailable (callers fall back to the local deterministic assistant).
export const askAI = async (messages, context) => {
  // Tool-using replies (live weather/route lookups) legitimately take a while:
  // model → tools → model again. Give them room before falling back.
  const t = withTimeout(45000);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, context }),
      signal: t.signal,
    });
    if (!res.ok) throw new Error('backend unavailable');
    const data = await res.json();
    if (!data.reply) throw new Error(data.error || 'no reply');
    return data;
  } finally {
    t.clear();
  }
};

/*
 * Backend liveness + capability, in one probe. Returns one of:
 *   'online'  — the /api backend is reachable AND an AI provider key is set,
 *               so real LLM replies are available.
 *   'basic'   — the backend is reachable but has no provider key, so replies
 *               come from the local rule-based assistant.
 *   'offline' — the backend didn't answer at all. On Vercel this is the honest
 *               answer to "is the chatbot function deployed / running?"; locally
 *               it means `npm run server` isn't up.
 * `providers` / `primary` are echoed through for the header tooltip.
 */
export const checkStatus = async () => {
  // try/finally, as askAI does: a t.clear() placed after the await is skipped
  // whenever fetch throws, leaving the 4s abort timer armed. Harmless in a
  // browser, but ChatWidget re-probes every 30s and each failed probe used to
  // keep the event loop alive for another 4s under test.
  const t = withTimeout(4000);
  try {
    const res = await fetch('/api/health', { signal: t.signal });
    if (!res.ok) return { status: 'offline', providers: null, primary: null };
    const data = await res.json();
    return {
      status: data.ai ? 'online' : 'basic',
      providers: data.providers || null,
      primary: data.primary || null,
    };
  } catch {
    return { status: 'offline', providers: null, primary: null };
  } finally {
    t.clear();
  }
};
