/*
 * One-command dev launcher: `npm start` boots the AetherAI backend (:3001) and
 * the CRA dev server (:3000, proxying /api → :3001) together, with prefixed
 * logs. No external deps — spawns both with Node built-ins and tears the pair
 * down together: if either process dies or you Ctrl-C, both stop.
 */
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// API_PORT must match the CRA "proxy" in package.json (:3001) for /api to work.
const API_PORT = process.env.API_PORT || '3001';
const WEB_PORT = process.env.WEB_PORT || process.env.PORT || '3000';

const COLORS = { api: '\x1b[36m', web: '\x1b[35m' };
const RESET = '\x1b[0m';

const children = [];
let shuttingDown = false;

const shutdown = (code) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM');
  }
  process.exit(code);
};

const prefix = (tag, stream, out) => {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) out.write(`${COLORS[tag]}[${tag}]${RESET} ${line}\n`);
  });
};

const run = (tag, args, env) => {
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, ...env } });
  children.push(child);
  prefix(tag, child.stdout, process.stdout);
  prefix(tag, child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`${COLORS[tag]}[${tag}]${RESET} exited (${code ?? 'killed'}) — stopping the other process`);
      shutdown(code ?? 0);
    }
  });
  return child;
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const portFree = (port) =>
  new Promise((resolve) => {
    const probe = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port);
  });

(async () => {
  // A leftover backend is the common failure — say so instead of a stack trace.
  if (!(await portFree(API_PORT))) {
    console.error(
      `Port ${API_PORT} is already in use — the backend seems to be running already ` +
        `(an old "npm run server" or "npm start"?). Stop it first, then rerun npm start.`
    );
    process.exit(1);
  }

  run('api', [path.join(ROOT, 'server', 'index.js')], { PORT: API_PORT });
  // Resolve the CRA binary directly so this works the same on every platform.
  run('web', [require.resolve('react-scripts/bin/react-scripts.js'), 'start'], {
    PORT: WEB_PORT,
    // CRA's dev server exits immediately in non-TTY shells without this.
    CI: process.env.CI || '',
  });
})();
