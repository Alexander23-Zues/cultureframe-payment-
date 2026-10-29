import { z } from 'zod';
import { db, atomic } from './db.js';
import { config, fail } from './config.js';
import { audit, notify } from './domain.js';

const external = z.string().trim().min(1).max(100);
const syncPageSchema = z.object({
  orders: z.array(z.lazy(() => importSchema)).max(1000),
  nextCursor: z.string().trim().min(1).max(500).nullable().optional(),
});
const syncKeys = ['_integrationUpdatedAfter', '_integrationLastSyncedAt'];
let syncInProgress = false;
export const importSchema = z.object({
  externalId: external,
  product: z.string().trim().min(2).max(200),
  quantity: z.number().int().min(1).max(1000),
  amountCents: z.number().int().min(1).max(100000000),
  currency: z.literal('PHP').default('PHP'),
  customer: z.object({ externalId: external, name: z.string().trim().min(2).max(100), email: z.string().email().max(190), phone: z.string().max(30).default(''), address: z.string().max(250).default('') }),
  seller: z.object({ externalId: external, name: z.string().trim().min(2).max(100), email: z.string().email().max(190), craft: z.string().min(2).max(100), location: z.string().max(200).default('Mansalay, Oriental Mindoro') }),
});
export async function importOrder(raw, source, actor) {
  const input = importSchema.parse(raw);
  return atomic(async tx => {
    const existing = await tx.order.findUnique({ where: { externalId: input.externalId }, include: { customer: true, seller: true } });
    if (existing) {
      fail(existing.amountCents !== input.amountCents || existing.product !== input.product || existing.quantity !== input.quantity || existing.source !== source || existing.customer.externalId !== input.customer.externalId || existing.seller.externalId !== input.seller.externalId, 409, 'An order with this reference already exists with different details.');
      if (source === 'CULTUREFRAME') {
        await Promise.all([
          tx.customer.update({ where: { id: existing.customerId }, data: { name: input.customer.name, email: input.customer.email, phone: input.customer.phone, address: input.customer.address } }),
          tx.seller.update({ where: { id: existing.sellerId }, data: { name: input.seller.name, email: input.seller.email, craft: input.seller.craft, location: input.seller.location } }),
        ]);
      }
      return existing;
    }
    const customer = await tx.customer.upsert({ where: { externalId: input.customer.externalId }, create: { ...input.customer, source }, update: source === 'CULTUREFRAME' ? { name: input.customer.name, email: input.customer.email, phone: input.customer.phone, address: input.customer.address } : {} });
    const seller = await tx.seller.upsert({ where: { externalId: input.seller.externalId }, create: { ...input.seller, source }, update: source === 'CULTUREFRAME' ? { name: input.seller.name, email: input.seller.email, craft: input.seller.craft, location: input.seller.location } : {} });
    fail(customer.source !== source || seller.source !== source, 409, 'Customer and seller references cannot be shared between simulator, imported, and live records.');
    const order = await tx.order.create({ data: { externalId: input.externalId, product: input.product, quantity: input.quantity, amountCents: input.amountCents, currency: 'PHP', customerId: customer.id, sellerId: seller.id, source } });
    await audit(tx, actor, 'ORDER_IMPORTED', 'order', order.id, { source, externalId: order.externalId });
    await tx.integrationLog.create({ data: { direction: 'INBOUND', operation: 'ORDER_IMPORT', status: source === 'SIMULATOR' ? 'SIMULATED' : 'COMPLETED', externalId: order.externalId, payload: JSON.stringify({ externalId: order.externalId, source }) } });
    return order;
  });
}
export async function integrationStatus() {
  const [logs, counts, syncSettings] = await Promise.all([
    db.integrationLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    db.order.groupBy({ by: ['source'], _count: { _all: true } }),
    db.systemSetting.findMany({ where: { key: { in: syncKeys } } }),
  ]);
  const state = Object.fromEntries(syncSettings.map(row => [row.key, JSON.parse(row.value)]));
  const apiConfigured = Boolean(process.env.CULTUREFRAME_API_URL && process.env.CULTUREFRAME_API_TOKEN);
  return { mode: config.simulator ? 'SIMULATOR' : 'LIVE_NOT_VERIFIED', database: process.env.DATABASE_URL?.startsWith('mysql:') ? 'MySQL' : 'SQLite · local development', apiConfigured, gatewayConfigured: Boolean(process.env.PAYMENT_WEBHOOK_SECRET), smtpConfigured: Boolean(process.env.SMTP_HOST), automaticSync: !config.simulator && apiConfigured && config.integrationAutoSync, syncIntervalMs: config.integrationSyncIntervalMs, lastSyncedAt: state._integrationLastSyncedAt || null, updatedAfter: state._integrationUpdatedAfter || null, liveVerified: false, website: 'https://jennycultureframe-1.onrender.com/', logs, counts };
}
export async function syncOrders(actor) {
  fail(config.simulator, 400, 'Use the simulator in development, or configure the live adapter to synchronize real orders.');
  fail(!process.env.CULTUREFRAME_API_URL || !process.env.CULTUREFRAME_API_TOKEN, 503, 'CultureFrame API credentials and an agreed API contract are required.');
  fail(syncInProgress, 409, 'Order synchronization is already running.');
  syncInProgress = true;
  const startedAt = new Date();
  const log = await db.integrationLog.create({ data: { direction: 'INBOUND', operation: 'ORDER_SYNC', payload: '{}', status: 'PROCESSING', attempts: 1 } });
  try {
    const previous = await db.systemSetting.findUnique({ where: { key: '_integrationUpdatedAfter' } });
    const updatedAfter = previous ? JSON.parse(previous.value) : null;
    let cursor = null, pages = 0, imported = 0;
    const seenCursors = new Set();
    do {
      fail(pages >= 100, 502, 'CultureFrame returned too many synchronization pages.');
      const url = new URL('orders', `${process.env.CULTUREFRAME_API_URL.replace(/\/$/, '')}/`);
      fail(url.protocol !== 'https:', 400, 'Live integration must use HTTPS.');
      if (updatedAfter) url.searchParams.set('updatedAfter', updatedAfter);
      if (cursor) url.searchParams.set('cursor', cursor);
      const response = await fetch(url, { headers: { authorization: `Bearer ${process.env.CULTUREFRAME_API_TOKEN}`, accept: 'application/json' }, signal: AbortSignal.timeout(15000), redirect: 'error' });
      fail(!response.ok, 502, `CultureFrame returned HTTP ${response.status}.`);
      const page = syncPageSchema.parse(await response.json());
      for (const order of page.orders) await importOrder(order, 'CULTUREFRAME', actor);
      imported += page.orders.length;
      pages++;
      const next = page.nextCursor || null;
      fail(next && seenCursors.has(next), 502, 'CultureFrame returned a repeated synchronization cursor.');
      if (next) seenCursors.add(next);
      cursor = next;
    } while (cursor);
    const completedAt = new Date();
    await atomic(async tx => {
      for (const [key, value] of [['_integrationUpdatedAfter', startedAt.toISOString()], ['_integrationLastSyncedAt', completedAt.toISOString()]]) {
        await tx.systemSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });
      }
      await tx.integrationLog.update({ where: { id: log.id }, data: { status: 'COMPLETED', payload: JSON.stringify({ imported, pages, updatedAfter: startedAt.toISOString() }), error: '', nextRetryAt: null } });
      await audit(tx, actor, 'INTEGRATION_SYNC', 'integration', log.id, { imported, pages, updatedAfter: startedAt.toISOString() });
    });
    return { imported, pages, updatedAfter: startedAt.toISOString() };
  } catch (error) {
    await db.integrationLog.update({ where: { id: log.id }, data: { status: 'FAILED', error: 'Order synchronization failed. Check the remote API contract and credentials.', nextRetryAt: new Date(Date.now() + 60000) } });
    await notify(db, 'INTEGRATION', 'Integration error', 'Order synchronization failed. Review integration logs.');
    throw error;
  } finally {
    syncInProgress = false;
  }
}
export async function retrySync(id, actor) {
  const log = await db.integrationLog.findUnique({ where: { id } });
  fail(!log || log.direction !== 'OUTBOUND' || !['PENDING', 'FAILED'].includes(log.status), 400, 'This event cannot be retried.');
  fail(!process.env.CULTUREFRAME_API_URL || !process.env.CULTUREFRAME_API_TOKEN, 503, 'Configure the CultureFrame API credentials first.');
  const claimed = await db.integrationLog.updateMany({ where: { id, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'PROCESSING', attempts: { increment: 1 } } });
  fail(!claimed.count, 409, 'Another worker is processing this event.');
  try {
    const url = new URL(`orders/${encodeURIComponent(log.externalId)}/payment-events`, `${process.env.CULTUREFRAME_API_URL.replace(/\/$/, '')}/`);
    fail(url.protocol !== 'https:', 400, 'Live integration must use HTTPS.');
    const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${process.env.CULTUREFRAME_API_TOKEN}`, 'content-type': 'application/json', 'idempotency-key': log.id }, body: log.payload, signal: AbortSignal.timeout(15000), redirect: 'error' });
    fail(!response.ok, 502, `CultureFrame returned HTTP ${response.status}.`);
    await db.integrationLog.update({ where: { id }, data: { status: 'COMPLETED', error: '', nextRetryAt: null } });
    await audit(db, actor, 'INTEGRATION_RETRY', 'integration', id);
    return { ok: true };
  } catch (error) {
    await db.integrationLog.update({ where: { id }, data: { status: 'FAILED', error: 'Delivery failed. Check the remote API and credentials.', nextRetryAt: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(log.attempts, 6))) } });
    await notify(db, 'INTEGRATION', 'Status synchronization failed', `Event ${log.id} can be retried after reviewing the remote connection.`);
    throw error;
  }
}
