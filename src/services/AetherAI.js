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
  try {
    const t = withTimeout(4000);
    const res = await fetch('/api/health', { signal: t.signal });
    t.clear();
    if (!res.ok) return { status: 'offline', providers: null, primary: null };
    const data = await res.json();
    return {
      status: data.ai ? 'online' : 'basic',
      providers: data.providers || null,
      primary: data.primary || null,
    };
  } catch {
    return { status: 'offline', providers: null, primary: null };
  }
};

/*
 * Per-provider status for Gemini and Groq, derived from GET /api/usage — but
 * only the status bits (configured / active / rate-limited / model), never the
 * token or call counts the usage panel used to show. Returns:
 *   { primary, providers: [{ id, label, model, configured, available,
 *                            exhausted, cooldownEndsAt }] }
 * or null if the backend can't be reached.
 *
 * NOTE: `available`/`exhausted` reflect one backend instance's memory. On Vercel
 * a fresh serverless instance starts with a clean slate, so a transient
 * rate-limit may not persist between calls — `configured` and which provider is
 * primary are the stable signals.
 */
export const getProviders = async () => {
  try {
    const t = withTimeout(4000);
    const res = await fetch('/api/usage', { signal: t.signal });
    t.clear();
    if (!res.ok) return null;
    const d = await res.json();
    const pick = (id) => {
      const p = d[id];
      if (!p) return null;
      return {
        id,
        label: p.label,
        model: p.model,
        configured: !!p.hasKey,
        available: !!p.available,
        exhausted: !!p.exhausted,
        cooldownEndsAt: p.cooldownEndsAt || null,
      };
    };
    return { primary: d.primary || 'gemini', providers: [pick('gemini'), pick('groq')].filter(Boolean) };
  } catch {
    return null;
  }
};
