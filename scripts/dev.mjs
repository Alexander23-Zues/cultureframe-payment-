import 'dotenv/config';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function portAvailable(port) {
  // Windows can allow a probe socket to bind an occupied address; check for a listener first.
  const connected = await new Promise((resolve, reject) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(500, () => finish(true));
    socket.once('connect', () => finish(true));
    socket.once('error', error => error.code === 'ECONNREFUSED' ? finish(false) : reject(error));
  });
  if (connected) return false;
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => server.close(() => resolve(true)));
  });
}
export async function availablePort(start, reserved = []) {
  for (let port = start; port < Math.min(start + 100, 65536); port++) {
    if (!reserved.includes(port) && await portAvailable(port)) return port;
  }
  throw new Error(`No available development port near ${start}.`);
}
function configuredPort(value, fallback) {
  const port = Number(value || fallback);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Development ports must be integers between 1024 and 65535.');
  return port;
}
export async function main() {
  const preferredWeb = configuredPort(process.env.VITE_PORT, 5175), preferredApi = configuredPort(process.env.PORT, 4000);
  const apiPort = await availablePort(preferredApi, [preferredWeb]);
  if (apiPort !== preferredApi) console.log(`Port ${preferredApi} is busy; using ${apiPort} for the API.`);
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const { createServer } = await import('vite');
  const web = await createServer({ root: cwd, server: {
    host: '127.0.0.1', port: preferredWeb, strictPort: false,
    proxy: { '/api': `http://127.0.0.1:${apiPort}` },
  } });
  // Vite binds the port itself and retries atomically if it is occupied.
  // A separate probe followed by strictPort startup has a race on Windows.
  try { await web.listen(); } catch (error) { await web.close(); throw error; }
  const webPort = web.httpServer.address().port;
  if (webPort === apiPort) { await web.close(); throw new Error('Web and API ports overlap. Set different VITE_PORT and PORT values.'); }
  const env = { ...process.env, NODE_ENV: 'development', PORT: String(apiPort), VITE_API_PORT: String(apiPort), VITE_PORT: String(webPort), APP_URL: `http://127.0.0.1:${webPort}` };
  console.log('\n  CultureFrame development server ready');
  web.printUrls();
  console.log(`  API: http://127.0.0.1:${apiPort}\n  Press Ctrl+C to stop.\n`);
  const api = spawn(process.execPath, ['--watch', 'server/index.js'], { cwd, env, stdio: 'inherit' });
  let stopping = false;
  async function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    if (api.exitCode === null && !api.killed) api.kill('SIGTERM');
    await web.close();
    process.exitCode = code;
  }
  process.on('SIGINT', () => stop());
  process.on('SIGTERM', () => stop());
  api.on('error', error => { console.error(error.message); stop(1); });
  api.on('exit', code => { if (!stopping) stop(code || 1); });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Could not start CultureFrame: ${error.message}`); process.exitCode = 1; });
}
