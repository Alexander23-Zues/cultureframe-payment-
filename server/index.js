import { app, validateConfig } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
import crypto from 'node:crypto';
import { audit } from './domain.js';
import { syncOrders } from './integration.js';
validateConfig();
await db.$connect();
await db.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
const fingerprint = crypto.createHash('sha256').update(JSON.stringify([process.env.INTEGRATION_MODE, process.env.CULTUREFRAME_API_URL, process.env.CULTUREFRAME_API_TOKEN, process.env.PAYMENT_WEBHOOK_SECRET, process.env.SMTP_HOST])).digest('hex');
const previous = await db.systemSetting.findUnique({ where: { key: '_integrationFingerprint' } });
if (previous?.value !== fingerprint) {
  await db.systemSetting.upsert({ where: { key: '_integrationFingerprint' }, create: { key: '_integrationFingerprint', value: fingerprint }, update: { value: fingerprint } });
  await audit(db, { ip: 'server-startup' }, 'INTEGRATION_CONFIG_CHANGED', 'integration', undefined, { mode: config.simulator ? 'SIMULATOR' : 'LIVE_NOT_VERIFIED' });
}
const server = app.listen(config.port, config.production ? '0.0.0.0' : '127.0.0.1', () => console.log(`CultureFrame API: http://localhost:${config.port} · ${config.simulator ? 'SIMULATOR (no real money)' : 'Live adapter unverified'}`));
const cleanup = setInterval(() => db.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {}), 3600000);
cleanup.unref();
const automaticSync = !config.simulator && config.integrationAutoSync && process.env.CULTUREFRAME_API_URL && process.env.CULTUREFRAME_API_TOKEN;
const runAutomaticSync = () => syncOrders({ ip: 'scheduled-sync' }).catch(error => console.error(`Scheduled CultureFrame sync failed: ${error.message}`));
const initialSync = automaticSync ? setTimeout(runAutomaticSync, 10000) : null;
const syncTimer = automaticSync ? setInterval(runAutomaticSync, config.integrationSyncIntervalMs) : null;
initialSync?.unref();
syncTimer?.unref();
async function shutdown() { clearInterval(cleanup); if (initialSync) clearTimeout(initialSync); if (syncTimer) clearInterval(syncTimer); server.close(); await db.$disconnect(); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
