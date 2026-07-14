// Talks to the AetherAI backend (server/index.js), which holds the AI keys and
// manages Gemini↔Groq failover + token usage.
// In dev, Create React App proxies /api → http://localhost:3001 (package.json "proxy").

const withTimeout = (ms) => {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(id) };
};

// Returns { reply, provider, model, usage }. Throws if the backend/keys are
// unavailable (callers fall back to the local deterministic assistant).
export const askAI = async (messages, context) => {
  const t = withTimeout(20000);
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

// Whether any AI provider is configured.
export const checkAI = async () => {
  try {
    const t = withTimeout(4000);
    const res = await fetch('/api/health', { signal: t.signal });
    t.clear();
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.ai;
  } catch {
    return false;
  }
};

// Per-provider token usage snapshot for the management panel.
export const getUsage = async () => {
  try {
    const t = withTimeout(4000);
    const res = await fetch('/api/usage', { signal: t.signal });
    t.clear();
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
};
