import 'dotenv/config';
import crypto from 'node:crypto';
export const config = {
  production: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 4000),
  appUrl: process.env.APP_URL || 'http://localhost:5175',
  sessionSecret: process.env.SESSION_SECRET || '',
  simulator: process.env.INTEGRATION_MODE === 'simulator',
  integrationAutoSync: process.env.INTEGRATION_AUTO_SYNC !== 'false',
  integrationSyncIntervalMs: Number(process.env.INTEGRATION_SYNC_INTERVAL_MS || 300000),
};
export function validateConfig() {
  if (config.sessionSecret.length < 32) throw new Error('Set SESSION_SECRET to at least 32 random characters in .env.');
  if (!Number.isInteger(config.integrationSyncIntervalMs) || config.integrationSyncIntervalMs < 60000 || config.integrationSyncIntervalMs > 86400000) throw new Error('INTEGRATION_SYNC_INTERVAL_MS must be an integer between 60000 and 86400000.');
  if (config.production && !config.appUrl.startsWith('https://')) throw new Error('Production APP_URL must use HTTPS.');
  if (config.production && !process.env.DATABASE_URL?.startsWith('mysql://')) throw new Error('Production requires MySQL. Generate the MySQL Prisma client first.');
  if (config.production && config.simulator) throw new Error('Simulator must be disabled in production.');
}
export const reference = prefix => `${prefix}-${new Date().getFullYear()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (condition, status, message) => { if (condition) throw new ApiError(status, message); };
