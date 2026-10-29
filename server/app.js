import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { z, ZodError } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { config, validateConfig, fail, ApiError } from './config.js';
import { db, atomic } from './db.js';
import { PrismaSessionStore } from './session-store.js';
import { auth, csrf, requireAdmin, requireChangedPassword, actor } from './auth.js';
import { createPayment, paymentAction, createRefund, refundAction, createPayout, payoutAction, paymentInclude, audit, settlePayment, settledStatuses } from './domain.js';
import { integrationStatus, syncOrders, retrySync, importOrder } from './integration.js';
import { paymentWhere, dateRange, reportData, earningsRows, csvResponse, pdfResponse, pdfLines, currency } from './reports.js';
import { createSimulatorOrder } from './simulator.js';

export const app = express();
app.disable('x-powered-by');
if (config.production) app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], fontSrc: ["'self'", 'data:'], connectSrc: ["'self'"], upgradeInsecureRequests: config.production ? [] : null } } }));
app.use('/api', rateLimit({ windowMs: 60000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests. Try again shortly.' } }));
app.post('/api/webhooks/payment', express.raw({ type: 'application/json', limit: '128kb' }), async (req, res) => {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  fail(!secret || secret.length < 32, 503, 'Payment provider adapter is not configured.');
  const timestamp = req.get('x-webhook-timestamp') || '';
  fail(!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300, 401, 'Invalid webhook timestamp.');
  fail(!Buffer.isBuffer(req.body), 400, 'Expected JSON payload.');
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(req.body).digest('hex');
  const received = req.get('x-webhook-signature') || '';
  fail(!/^[a-f0-9]{64}$/.test(received) || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received)), 401, 'Invalid webhook signature.');
  const input = z.object({ id: z.string().min(8).max(100), paymentId: z.string().max(100), status: z.literal('SUCCEEDED'), amountCents: z.number().int().positive(), currency: z.literal('PHP'), providerReference: z.string().min(3).max(190) }).parse(JSON.parse(req.body.toString()));
  await atomic(async tx => {
    const existing = await tx.webhookEvent.findUnique({ where: { id: input.id } });
    if (existing) { fail(existing.payload !== req.body.toString(), 409, 'Webhook event ID already belongs to another payload.'); return; }
    const payment = await tx.payment.findUnique({ where: { id: input.paymentId } });
    fail(!payment || payment.provider !== 'GATEWAY', 400, 'This event does not belong to a gateway payment.');
    fail(payment.amountCents !== input.amountCents, 400, 'Payment amount does not match.');
    await tx.webhookEvent.create({ data: { id: input.id, provider: 'CUSTOM_GATEWAY', payload: req.body.toString(), status: 'PROCESSED' } });
    await settlePayment(tx, payment, { ip: req.ip }, input.providerReference, 'Verified HMAC provider event.');
  });
  res.json({ received: true });
});
app.use(express.json({ limit: '256kb' }));
app.use(session({ name: 'cf.sid', secret: config.sessionSecret || 'invalid-secret-set-env-before-starting', resave: false, saveUninitialized: false, store: new PrismaSessionStore(), cookie: { httpOnly: true, secure: config.production, sameSite: 'strict', maxAge: 8 * 3600000 } }));
app.get('/api/health', async (req, res) => { await db.$queryRaw`SELECT 1`; res.json({ status: 'ok', mode: config.simulator ? 'simulator' : 'live-unverified' }); });
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, csrf);
app.use('/api/auth', auth);
const api = express.Router();
api.use(requireAdmin, requireChangedPassword);
app.use('/api', api);

const idempotencyKey = z.string().min(8).max(100);
const id = z.string().min(1).max(100);
const amountCents = z.number().int().min(1).max(100000000);
const actionSchema = z.object({ action: z.string().max(30), note: z.string().max(1000).optional(), evidence: z.string().max(1500).optional(), providerReference: z.string().trim().min(3).max(190).optional() });
const externalId = z.string().trim().min(1).max(100);
const customerInput = z.object({ externalId, name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(190), phone: z.string().trim().max(30).default(''), address: z.string().trim().max(250).default('') });
const sellerInput = z.object({ externalId, name: z.string().trim().min(2).max(100), email: z.string().trim().email().max(190), craft: z.string().trim().min(2).max(100), location: z.string().trim().min(2).max(200).default('Mansalay, Oriental Mindoro') });
function paging(query) {
  return { page: z.coerce.number().int().min(1).max(1000000).default(1).parse(query.page), limit: z.coerce.number().int().min(1).max(100).default(10).parse(query.limit) };
}
api.get('/dashboard', async (req, res) => {
  const data = await reportData(req.query);
  const [notifications, earnings] = await Promise.all([db.notification.count({ where: { readAt: null } }), earningsRows()]);
  res.json({ ...data, payments: data.payments.slice(0, 6), ledger: undefined, refunds: data.refunds.slice(0, 5), earnings: earnings.map(e => ({ name: e.name, netCents: e.netCents, craft: e.craft, source: e.source })), unreadNotifications: notifications, mode: config.simulator ? 'SIMULATOR' : 'LIVE_NOT_VERIFIED' });
});
const paymentMethodInput = z.object({
  name: z.string().trim().min(2).max(80),
  kind: z.enum(['MANUAL', 'SIMULATOR']),
  enabled: z.boolean(),
});
const methodResponse = method => ({ ...method, usageCount: method._count?.payments || 0, _count: undefined });
api.get('/methods', async (req, res) => {
  const methods = await db.paymentMethod.findMany({ include: { _count: { select: { payments: true } } }, orderBy: [{ kind: 'asc' }, { name: 'asc' }] });
  res.json(methods.map(methodResponse));
});
api.post('/methods', async (req, res) => {
  const input = paymentMethodInput.parse(req.body);
  fail(input.kind === 'SIMULATOR' && input.enabled && !config.simulator, 403, 'Simulator methods can only be enabled in the development simulator.');
  const method = await atomic(async tx => {
    const names = await tx.paymentMethod.findMany({ select: { name: true } });
    fail(names.some(row => row.name.toLowerCase() === input.name.toLowerCase()), 409, 'A payment method with this name already exists.');
    const created = await tx.paymentMethod.create({ data: { id: crypto.randomUUID(), ...input } });
    await audit(tx, actor(req), 'PAYMENT_METHOD_CREATED', 'method', created.id, input);
    return created;
  });
  res.status(201).json({ ...method, usageCount: 0 });
});
api.get('/orders', async (req, res) => res.json(await db.order.findMany({ include: { customer: true, seller: true, payments: { select: { id: true, status: true } } }, orderBy: { createdAt: 'desc' } })));
api.get(['/payments', '/transactions'], async (req, res) => {
  const { page, limit } = paging(req.query);
  const where = paymentWhere(req.query);
  const sort = z.enum(['createdAt', 'amountCents', 'reference', 'status']).default('createdAt').parse(req.query.sort);
  const direction = z.enum(['asc', 'desc']).default('desc').parse(req.query.direction);
  const [rows, total] = await Promise.all([db.payment.findMany({ where, include: paymentInclude, orderBy: { [sort]: direction }, skip: (page - 1) * limit, take: limit }), db.payment.count({ where })]);
  let summary;
  if (req.path === '/transactions') {
    const verified = await db.payment.aggregate({ where: { AND: [where, { status: { in: settledStatuses } }] }, _sum: { amountCents: true, refundedCents: true } });
    const verifiedCents = verified._sum.amountCents || 0, refundedCents = verified._sum.refundedCents || 0;
    summary = { verifiedCents, refundedCents, netVerifiedCents: verifiedCents - refundedCents };
  }
  res.json({ rows, total, page, limit, ...(summary ? { summary } : {}) });
});
api.post('/payments', async (req, res) => {
  const input = z.object({ orderId: id, methodId: id, evidence: z.string().max(1500).default(''), idempotencyKey }).parse(req.body);
  res.status(201).json(await createPayment(input, actor(req)));
});
api.get('/payments/:id', async (req, res) => {
  const payment = await db.payment.findUnique({ where: { id: req.params.id }, include: { ...paymentInclude, events: true, attempts: true, earning: true } });
  fail(!payment, 404, 'Payment not found.'); res.json(payment);
});
api.post('/payments/:id/actions', async (req, res) => res.json(await paymentAction(req.params.id, actionSchema.parse(req.body), actor(req))));
api.get('/refunds', async (req, res) => {
  const { page, limit } = paging(req.query);
  const where = { ...(dateRange(req.query) ? { createdAt: dateRange(req.query) } : {}), ...(req.query.status ? { status: z.enum(['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'FAILED']).parse(req.query.status) } : {}), ...(req.query.q ? { OR: [{ reference: { contains: String(req.query.q).slice(0, 150) } }, { reason: { contains: String(req.query.q).slice(0, 150) } }] } : {}) };
  const [rows, total] = await Promise.all([db.refund.findMany({ where, include: { payment: { include: paymentInclude }, transactions: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), db.refund.count({ where })]);
  res.json({ rows, total, page, limit });
});
api.post('/refunds', async (req, res) => res.status(201).json(await createRefund(z.object({ paymentId: id, amountCents, reason: z.string().trim().min(5).max(1000), idempotencyKey }).parse(req.body), actor(req))));
api.post('/refunds/:id/actions', async (req, res) => res.json(await refundAction(req.params.id, actionSchema.parse(req.body), actor(req))));
api.get('/receipts', async (req, res) => {
  const { page, limit } = paging(req.query);
  const where = req.query.q ? { OR: [{ number: { contains: String(req.query.q).slice(0, 150) } }, { payment: { reference: { contains: String(req.query.q).slice(0, 150) } } }, { payment: { order: { customer: { name: { contains: String(req.query.q).slice(0, 150) } } } } }] } : {};
  const [rows, total] = await Promise.all([db.receipt.findMany({ where, include: { payment: { include: paymentInclude } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), db.receipt.count({ where })]);
  res.json({ rows, total, page, limit });
});
api.get('/receipts/:id/pdf', async (req, res) => {
  const receipt = await db.receipt.findUnique({ where: { id: req.params.id }, include: { payment: { include: paymentInclude } } });
  fail(!receipt || !settledStatuses.includes(receipt.payment.status), 404, 'Verified receipt not found.');
  const p = receipt.payment;
  await audit(db, actor(req), 'RECEIPT_DOWNLOADED', 'receipt', receipt.id);
  pdfResponse(res, receipt.number, 'Payment receipt', doc => pdfLines(doc, [`Receipt: ${receipt.number}`, `Transaction: ${p.reference}`, `CultureFrame order: ${p.order.externalId}`, `Customer: ${p.order.customer.name}`, `Seller: ${p.order.seller.name}`, `Product: ${p.order.product} (quantity ${p.order.quantity})`, `Amount paid: ${currency(p.amountCents)}`, `Refunded: ${currency(p.refundedCents)}`, `Method: ${p.method.name}`, `Transfer reference: ${p.providerReference}`, `Verified: ${new Date(p.verifiedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} (Asia/Manila)`, `Current status: ${p.status}`, '', 'This is a payment acknowledgment, not a BIR tax invoice.']), p.provider === 'SIMULATOR' || p.order.source === 'SIMULATOR');
});
api.get('/customers', async (req, res) => {
  const rows = await db.customer.findMany({ include: { orders: { include: { payments: { include: { refunds: true } } } } }, orderBy: { name: 'asc' } });
  res.json(rows.map(c => ({ ...c, totalSpentCents: c.orders.flatMap(o => o.payments).filter(p => settledStatuses.includes(p.status)).reduce((n, p) => n + p.amountCents - p.refundedCents, 0), orderCount: c.orders.length })));
});
api.post('/customers', async (req, res) => {
  const input = customerInput.parse(req.body);
  const customer = await atomic(async tx => {
    fail(await tx.customer.findUnique({ where: { externalId: input.externalId } }), 409, 'A customer with this reference already exists.');
    const created = await tx.customer.create({ data: { ...input, source: 'ADMIN_IMPORT' } });
    await audit(tx, actor(req), 'CUSTOMER_CREATED', 'customer', created.id, { externalId: created.externalId });
    return created;
  });
  res.status(201).json({ ...customer, orders: [], totalSpentCents: 0, orderCount: 0 });
});
api.patch('/customers/:id', async (req, res) => {
  const input = customerInput.partial().strict().refine(value => Object.keys(value).length > 0, 'Provide at least one field.').parse(req.body);
  const customer = await atomic(async tx => {
    const existing = await tx.customer.findUnique({ where: { id: req.params.id }, include: { _count: { select: { orders: true } } } });
    fail(!existing, 404, 'Customer not found.');
    fail(existing.source !== 'ADMIN_IMPORT', 409, 'Synchronized and simulator customers must be updated by their source system.');
    fail(input.externalId && input.externalId !== existing.externalId && existing._count.orders > 0, 409, 'A customer reference linked to orders cannot be changed.');
    const updated = await tx.customer.update({ where: { id: existing.id }, data: input });
    await audit(tx, actor(req), 'CUSTOMER_UPDATED', 'customer', existing.id, input);
    return updated;
  });
  res.json(customer);
});
api.delete('/customers/:id', async (req, res) => {
  await atomic(async tx => {
    const customer = await tx.customer.findUnique({ where: { id: req.params.id }, include: { _count: { select: { orders: true } } } });
    fail(!customer, 404, 'Customer not found.');
    fail(customer.source !== 'ADMIN_IMPORT', 409, 'Synchronized and simulator customers are managed by their source system.');
    fail(customer._count.orders > 0, 409, 'This customer is linked to orders and cannot be deleted.');
    await tx.customer.delete({ where: { id: customer.id } });
    await audit(tx, actor(req), 'CUSTOMER_DELETED', 'customer', customer.id, { externalId: customer.externalId });
  });
  res.json({ ok: true });
});
api.get('/sellers', async (req, res) => res.json(await earningsRows()));
api.post('/sellers', async (req, res) => {
  const input = sellerInput.parse(req.body);
  const seller = await atomic(async tx => {
    fail(await tx.seller.findUnique({ where: { externalId: input.externalId } }), 409, 'A seller with this reference already exists.');
    const created = await tx.seller.create({ data: { ...input, source: 'ADMIN_IMPORT' } });
    await audit(tx, actor(req), 'SELLER_CREATED', 'seller', created.id, { externalId: created.externalId });
    return created;
  });
  res.status(201).json({ ...seller, orders: [], earnings: [], payouts: [], grossCents: 0, commissionCents: 0, feeCents: 0, refundCents: 0, netCents: 0, paidCents: 0, pendingSettlementCents: 0, balanceCents: 0, reservedCents: 0, availableCents: 0 });
});
api.patch('/sellers/:id', async (req, res) => {
  const input = sellerInput.partial().strict().refine(value => Object.keys(value).length > 0, 'Provide at least one field.').parse(req.body);
  const seller = await atomic(async tx => {
    const existing = await tx.seller.findUnique({ where: { id: req.params.id }, include: { _count: { select: { orders: true } } } });
    fail(!existing, 404, 'Seller not found.');
    fail(existing.source !== 'ADMIN_IMPORT', 409, 'Synchronized and simulator sellers must be updated by their source system.');
    fail(input.externalId && input.externalId !== existing.externalId && existing._count.orders > 0, 409, 'A seller reference linked to orders cannot be changed.');
    const updated = await tx.seller.update({ where: { id: existing.id }, data: input });
    await audit(tx, actor(req), 'SELLER_UPDATED', 'seller', existing.id, input);
    return updated;
  });
  res.json(seller);
});
api.delete('/sellers/:id', async (req, res) => {
  await atomic(async tx => {
    const seller = await tx.seller.findUnique({ where: { id: req.params.id }, include: { _count: { select: { orders: true, payouts: true, earnings: true, ledger: true } } } });
    fail(!seller, 404, 'Seller not found.');
    fail(seller.source !== 'ADMIN_IMPORT', 409, 'Synchronized and simulator sellers are managed by their source system.');
    fail(seller._count.orders + seller._count.payouts + seller._count.earnings + seller._count.ledger > 0, 409, 'This seller has order or financial history and cannot be deleted.');
    await tx.seller.delete({ where: { id: seller.id } });
    await audit(tx, actor(req), 'SELLER_DELETED', 'seller', seller.id, { externalId: seller.externalId });
  });
  res.json({ ok: true });
});
api.get('/earnings', async (req, res) => res.json(await earningsRows()));
api.get('/ledger', async (req, res) => res.json(await db.ledgerEntry.findMany({ where: req.query.sellerId ? { sellerId: id.parse(req.query.sellerId) } : {}, include: { seller: true }, orderBy: { createdAt: 'desc' } })));
api.get('/payouts', async (req, res) => {
  const { page, limit } = paging(req.query);
  const where = { ...(req.query.status ? { status: z.enum(['REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED']).parse(req.query.status) } : {}), ...(req.query.q ? { OR: [{ reference: { contains: String(req.query.q).slice(0, 150) } }, { seller: { name: { contains: String(req.query.q).slice(0, 150) } } }] } : {}) };
  const [rows, total] = await Promise.all([db.sellerPayout.findMany({ where, include: { seller: true }, orderBy: { createdAt: 'desc' }, take: limit, skip: (page - 1) * limit }), db.sellerPayout.count({ where })]);
  res.json({ rows, total, page, limit });
});
api.post('/payouts', async (req, res) => res.status(201).json(await createPayout(z.object({ sellerId: id, amountCents, destination: z.string().trim().min(5).max(300), idempotencyKey }).parse(req.body), actor(req))));
api.post('/payouts/:id/actions', async (req, res) => res.json(await payoutAction(req.params.id, actionSchema.parse(req.body), actor(req))));
api.get('/reports', async (req, res) => res.json(await reportData(req.query)));
api.get('/exports/:module/:format', async (req, res) => {
  const module = z.enum(['payments', 'transactions', 'refunds', 'payouts', 'earnings', 'reports', 'ledger']).parse(req.params.module);
  const format = z.enum(['csv', 'pdf']).parse(req.params.format);
  const data = await reportData(req.query);
  let headers, rows;
  if (['payments', 'transactions', 'reports'].includes(module)) {
    headers = ['Reference', 'Order', 'Customer', 'Seller', 'Product', 'Amount PHP', 'Refunded PHP', 'Method', 'Status', 'Source', 'Created ISO'];
    rows = data.payments.map(p => [p.reference, p.order.externalId, p.order.customer.name, p.order.seller.name, p.order.product, (p.amountCents / 100).toFixed(2), (p.refundedCents / 100).toFixed(2), p.method.name, p.status, p.order.source, p.createdAt.toISOString()]);
  } else if (module === 'refunds') {
    const status = req.query.refundStatus;
    const refunds = data.refunds.filter(r => !status || r.status === status).filter(r => !req.query.q || `${r.reference} ${r.reason}`.toLowerCase().includes(String(req.query.q).toLowerCase()));
    headers = ['Reference', 'Payment', 'Amount PHP', 'Reason', 'Status', 'Updated ISO'];
    rows = refunds.map(r => [r.reference, r.payment.reference, (r.amountCents / 100).toFixed(2), r.reason, r.status, r.updatedAt.toISOString()]);
  } else if (module === 'payouts') {
    headers = ['Reference', 'Seller', 'Amount PHP', 'Status', 'Transfer reference', 'Updated ISO'];
    rows = data.payouts.filter(p => !req.query.payoutStatus || p.status === req.query.payoutStatus).filter(p => !req.query.q || `${p.reference} ${p.seller.name}`.toLowerCase().includes(String(req.query.q).toLowerCase())).map(p => [p.reference, p.seller.name, (p.amountCents / 100).toFixed(2), p.status, p.providerReference, p.updatedAt.toISOString()]);
  } else if (module === 'ledger') {
    headers = ['Reference', 'Seller', 'Kind', 'Amount PHP', 'Description', 'Created ISO'];
    rows = data.ledger.map(l => [l.reference, l.seller.name, l.kind, (l.amountCents / 100).toFixed(2), l.description, l.createdAt.toISOString()]);
  } else {
    headers = ['Seller', 'Gross PHP', 'Commission PHP', 'Fees PHP', 'Refunds PHP', 'Net PHP', 'Available PHP'];
    rows = (await earningsRows()).filter(e => !req.query.q || `${e.name} ${e.craft}`.toLowerCase().includes(String(req.query.q).toLowerCase())).map(e => [e.name, ...[e.grossCents, e.commissionCents, e.feeCents, e.refundCents, e.netCents, e.availableCents].map(v => (v / 100).toFixed(2))]);
  }
  await audit(db, actor(req), 'REPORT_EXPORTED', module, undefined, { format, rows: rows.length });
  if (format === 'csv') return csvResponse(res, `cultureframe-${module}`, headers, rows);
  pdfResponse(res, `cultureframe-${module}`, `${module[0].toUpperCase()}${module.slice(1)} report`, doc => {
    doc.text(`Generated ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} (Asia/Manila)`);
    if (req.query.from || req.query.to) doc.text(`Period: ${req.query.from || 'Beginning'} to ${req.query.to || 'Present'}`);
    doc.moveDown();
    pdfLines(doc, rows.map(row => row.map((v, i) => `${headers[i]}: ${v ?? '—'}`).join(' | ')));
  }, config.simulator);
});
api.get('/notifications', async (req, res) => res.json(await db.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 200 })));
api.patch('/notifications/:id/read', async (req, res) => { const where = req.params.id === 'all' ? { readAt: null } : { id: req.params.id }; await db.notification.updateMany({ where, data: { readAt: new Date() } }); res.json({ ok: true }); });
api.delete('/notifications/:id', async (req, res) => {
  const result = req.params.id === 'read' ? await db.notification.deleteMany({ where: { readAt: { not: null } } }) : await db.notification.deleteMany({ where: { id: req.params.id } });
  fail(req.params.id !== 'read' && !result.count, 404, 'Notification not found.');
  await audit(db, actor(req), 'NOTIFICATION_DELETED', 'notification', req.params.id === 'read' ? undefined : req.params.id, { count: result.count });
  res.json({ ok: true, deleted: result.count });
});
api.get('/audit', async (req, res) => {
  const { page, limit } = paging(req.query);
  const where = req.query.q ? { OR: [{ action: { contains: String(req.query.q).slice(0, 150) } }, { details: { contains: String(req.query.q).slice(0, 150) } }] } : {};
  const [rows, total] = await Promise.all([db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: (page - 1) * limit }), db.auditLog.count({ where })]);
  res.json({ rows, total, page, limit });
});
api.get('/settings', async (req, res) => res.json(Object.fromEntries((await db.systemSetting.findMany()).filter(setting => !setting.key.startsWith('_')).map(s => [s.key, JSON.parse(s.value)]))));
api.patch('/settings', async (req, res) => {
  const input = z.object({ organizationName: z.string().trim().min(2).max(100), contactEmail: z.string().email(), commissionBps: z.number().int().min(0).max(3000), refundDays: z.number().int().min(1).max(365), notificationsEnabled: z.boolean() }).strict().parse(req.body);
  await atomic(async tx => {
    for (const [key, value] of Object.entries(input)) await tx.systemSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(value) }, update: { value: JSON.stringify(value) } });
    await audit(tx, actor(req), 'SETTINGS_UPDATED', 'settings', undefined, input);
  });
  res.json(input);
});
api.patch('/methods/:id', async (req, res) => {
  const input = paymentMethodInput.partial().strict().refine(value => Object.keys(value).length > 0, 'Provide at least one field.').parse(req.body);
  const updated = await atomic(async tx => {
    const method = await tx.paymentMethod.findUnique({ where: { id: req.params.id }, include: { _count: { select: { payments: true } } } });
    fail(!method, 404, 'Payment method not found.');
    const nextKind = input.kind || method.kind;
    const nextEnabled = input.enabled ?? method.enabled;
    fail(nextKind === 'SIMULATOR' && nextEnabled && !config.simulator, 403, 'Simulator methods can only be enabled in the development simulator.');
    const changesIdentity = (input.name && input.name !== method.name) || (input.kind && input.kind !== method.kind);
    fail(changesIdentity && method._count.payments > 0, 409, 'A method used by payments cannot be renamed or retyped. Disable it to preserve financial history.');
    if (input.name && input.name.toLowerCase() !== method.name.toLowerCase()) {
      const names = await tx.paymentMethod.findMany({ where: { id: { not: method.id } }, select: { name: true } });
      fail(names.some(row => row.name.toLowerCase() === input.name.toLowerCase()), 409, 'A payment method with this name already exists.');
    }
    const result = await tx.paymentMethod.update({ where: { id: method.id }, data: input });
    await audit(tx, actor(req), 'PAYMENT_METHOD_UPDATED', 'method', method.id, input);
    return { ...result, usageCount: method._count.payments };
  });
  res.json(updated);
});
api.delete('/methods/:id', async (req, res) => {
  await atomic(async tx => {
    const method = await tx.paymentMethod.findUnique({ where: { id: req.params.id }, include: { _count: { select: { payments: true } } } });
    fail(!method, 404, 'Payment method not found.');
    fail(method._count.payments > 0, 409, 'This method is part of payment history and cannot be deleted. Disable it instead.');
    await tx.paymentMethod.delete({ where: { id: method.id } });
    await audit(tx, actor(req), 'PAYMENT_METHOD_DELETED', 'method', method.id, { name: method.name, kind: method.kind });
  });
  res.json({ ok: true });
});
api.get('/integration', async (req, res) => res.json(await integrationStatus()));
api.post('/integration/import', async (req, res) => res.status(201).json(await importOrder(req.body, 'ADMIN_IMPORT', actor(req))));
api.post('/integration/simulate-order', async (req, res) => { fail(!config.simulator, 403, 'Simulator is disabled.'); res.status(201).json(await createSimulatorOrder(actor(req))); });
api.post('/integration/sync', async (req, res) => res.json(await syncOrders(actor(req))));
api.post('/integration/logs/:id/retry', async (req, res) => res.json(await retrySync(req.params.id, actor(req))));

app.use('/api', (req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
const dist = path.resolve('dist');
if (fs.existsSync(dist)) { app.use(express.static(dist)); app.get('/{*path}', (req, res) => res.sendFile(path.join(dist, 'index.html'))); }
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof ZodError) return res.status(400).json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
  if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
  if (error.code === 'P2002') return res.status(409).json({ error: 'This reference is already recorded. Refresh before retrying.' });
  if (error.code === 'P2025') return res.status(404).json({ error: 'Record not found.' });
  if (error instanceof SyntaxError) return res.status(400).json({ error: 'Invalid JSON request.' });
  console.error('Request failed:', error.code || error.name, error.message?.replace(/mysql:\/\/[^\s]+/g, '[database]'));
  res.status(500).json({ error: 'The operation could not be completed. Please try again.' });
});
export { validateConfig };
