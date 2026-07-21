/*
 * AetherAI local dev backend — thin node:http wrapper around the shared
 * handlers in api/_lib/core.js (the same code Vercel runs in production as
 * serverless functions under /api).
 *
 *   Run:  npm run server   (listens on :3001; CRA dev server proxies /api → here)
 */
const http = require('http');
const core = require('../api/_lib/core');

const PORT = process.env.PORT || 3001;

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return json(res, 204, {});

  let pathname = req.url;
  let params = {};
  try {
    const u = new URL(req.url, 'http://localhost');
    pathname = u.pathname;
    params = Object.fromEntries(u.searchParams);
  } catch {
    /* keep raw */
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    const { status, body } = core.healthHandler();
    return json(res, status, body);
  }
  if (req.method === 'GET' && pathname === '/api/usage') {
    const { status, body } = core.usageHandler();
    return json(res, status, body);
  }
  if (req.method === 'GET' && pathname === '/api/geocode') {
    return core
      .geocodeHandler(params.q, params.near, params.limit)
      .then(({ status, body }) => json(res, status, body));
  }
  if (req.method === 'GET' && pathname === '/api/resolve') {
    return core.resolveHandler(params.url).then(({ status, body }) => json(res, status, body));
  }
  if (req.method === 'GET' && pathname === '/api/route') {
    return core.routeHandler(params.from, params.to).then(({ status, body }) => json(res, status, body));
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      let body;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        return json(res, 400, { error: 'bad_json' });
      }
      const { status, body: out } = await core.chatHandler(body);
      json(res, status, out);
    });
    return;
  }

  json(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => {
  const provs = core.ORDER.filter(core.hasKey)
    .map((p) => `${core.META[p].label}(${core.META[p].model})`)
    .join(' → ') || 'NONE';
  console.log(`AetherAI backend → http://localhost:${PORT}  providers: ${provs}`);
});
