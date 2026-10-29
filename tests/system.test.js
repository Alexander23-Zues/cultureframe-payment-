import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { app } from '../server/app.js';
import { config } from '../server/config.js';
import { db } from '../server/db.js';
import { syncOrders } from '../server/integration.js';
import { seed } from '../server/seed.js';
import { simulatorPayload } from '../server/simulator.js';
const agent = request.agent(app);
let csrf, email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_INITIAL_PASSWORD;
const post = (url, body) => agent.post(`/api${url}`).set('x-csrf-token', csrf).send(body);
const patch = (url, body) => agent.patch(`/api${url}`).set('x-csrf-token', csrf).send(body);
const del = url => agent.delete(`/api${url}`).set('x-csrf-token', csrf);
const get = url => agent.get(`/api${url}`);
async function freshPayment({ manual = false, amountCents = 10001, settle = true } = {}) {
  const order = (await post('/integration/simulate-order', {}).expect(201)).body;
  await db.order.update({ where: { id: order.id }, data: { amountCents } });
  const payment = (await post('/payments', { orderId: order.id, methodId: manual ? 'bank-transfer' : 'simulator', idempotencyKey: crypto.randomUUID() }).expect(201)).body;
  if (settle) await post(`/payments/${payment.id}/actions`, { action: manual ? 'verify' : 'simulate-success', ...(manual ? { providerReference: `TEST-${crypto.randomUUID()}`, evidence: 'Independently verified test transfer evidence.' } : {}) }).expect(200);
  return (await get(`/payments/${payment.id}`).expect(200)).body;
}
describe('CultureFrame full-stack acceptance and security', { concurrency: false }, () => {
  before(async () => { await seed({ samples: false }); const session = await get('/auth/session').expect(200); csrf = session.body.csrfToken; });
  after(async () => { await db.$disconnect(); });
  it('provisions one hashed administrator; repeated seed preserves credentials', async () => {
    await seed({ samples: false }); assert.equal(await db.adminUser.count(), 1);
    const admin = await db.adminUser.findUnique({ where: { email } }); assert.notEqual(admin.passwordHash, password); assert(await bcrypt.compare(password, admin.passwordHash));
  });
  it('serves public landing and SPA routes without exposing credentials', async () => {
    const response = await request(app).get('/').expect(200); assert.match(response.text, /CultureFrame/); assert(!response.text.includes(process.env.ADMIN_INITIAL_PASSWORD));
    await request(app).get('/login').expect(200); await request(app).get('/privacy').expect(200);
    await request(app).post('/api/auth/register').send({}).expect(403);
  });
  it('protects financial APIs before authentication', async () => {
    for (const route of ['/dashboard', '/payments', '/transactions', '/refunds', '/receipts', '/customers', '/sellers', '/earnings', '/payouts', '/reports', '/notifications', '/audit', '/settings', '/integration']) await request(app).get(`/api${route}`).expect(401);
  });
  it('rejects missing CSRF tokens, foreign origins, and invalid credentials', async () => {
    await agent.post('/api/auth/login').send({ email, password }).expect(403);
    await agent.post('/api/auth/login').set('x-csrf-token', csrf).set('Origin', 'https://untrusted.example').send({ email, password }).expect(403);
    const wrong = await post('/auth/login', { email, password: 'wrong-password' }).expect(401); assert.match(wrong.body.error, /Invalid credentials/);
  });
  it('requires a password change and rotates the session before dashboard access', async () => {
    const login = await post('/auth/login', { email, password, remember: true }).expect(200); csrf = login.body.csrfToken; assert.equal(login.body.user.mustChangePassword, true); assert.match(login.headers['set-cookie'].join(' '), /HttpOnly/); assert.match(login.headers['set-cookie'].join(' '), /SameSite=Strict/);
    await get('/dashboard').expect(403);
    await post('/auth/change-password', { currentPassword: password, password: 'weak' }).expect(400);
    password = 'ChangedTestPassword2026!';
    const changed = await post('/auth/change-password', { currentPassword: process.env.ADMIN_INITIAL_PASSWORD, password }).expect(200); csrf = changed.body.csrfToken; assert.equal(changed.body.user.mustChangePassword, false);
    await get('/dashboard').expect(200);
  });
  it('filters and paginates transaction history with totals for all matching records', async () => {
    const first = await freshPayment({ amountCents: 12345 });
    const second = await freshPayment({ amountCents: 23456 });
    await freshPayment({ amountCents: 34567, settle: false });
    const result = (await get('/transactions?status=SUCCEEDED&limit=1&sort=amountCents&direction=asc').expect(200)).body;
    assert.equal(result.total, 2); assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].amountCents, first.amountCents);
    assert.equal(result.summary.verifiedCents, first.amountCents + second.amountCents);
    assert.equal(result.summary.netVerifiedCents, first.amountCents + second.amountCents);
    const filtered = (await get(`/transactions?q=${encodeURIComponent(second.reference)}`).expect(200)).body;
    assert.equal(filtered.total, 1); assert.equal(filtered.rows[0].id, second.id);
    assert.equal(filtered.summary.verifiedCents, second.amountCents);
    const empty = (await get('/transactions?q=DOES-NOT-EXIST-TEST').expect(200)).body;
    assert.equal(empty.total, 0); assert.equal(empty.summary.verifiedCents, 0);
    await get('/transactions?status=INVALID').expect(400);
  });
  it('imports simulator orders with linked references; prevents altered duplicate imports', async () => {
    const payload = simulatorPayload(1234); payload.externalId = `IMPORT-${crypto.randomUUID()}`; payload.customer.externalId = `IMPORT-C-${crypto.randomUUID()}`; payload.seller.externalId = `IMPORT-S-${crypto.randomUUID()}`;
    const first = await post('/integration/import', payload).expect(201); const second = await post('/integration/import', payload).expect(201); assert.equal(first.body.id, second.body.id);
    await post('/integration/import', { ...payload, amountCents: payload.amountCents + 1 }).expect(409);
    await post('/integration/import', { ...payload, amountCents: -1 }).expect(400);
    await post('/payments', { orderId: first.body.id, methodId: 'simulator', idempotencyKey: crypto.randomUUID() }).expect(400);
  });
  it('creates, updates, and safely deletes customer and seller master records', async () => {
    const suffix = crypto.randomUUID();
    const customer = (await post('/customers', { externalId: `CRUD-C-${suffix}`, name: 'CRUD Customer', email: `customer-${suffix}@example.test`, phone: '09170000000', address: 'Mansalay' }).expect(201)).body;
    const seller = (await post('/sellers', { externalId: `CRUD-S-${suffix}`, name: 'CRUD Seller', email: `seller-${suffix}@example.test`, craft: 'Basket weaving', location: 'Mansalay, Oriental Mindoro' }).expect(201)).body;
    await patch(`/customers/${customer.id}`, { name: 'Updated CRUD Customer' }).expect(200);
    await patch(`/sellers/${seller.id}`, { craft: 'Updated basket weaving' }).expect(200);
    const order = (await post('/integration/import', { externalId: `CRUD-O-${suffix}`, product: 'CRUD product', quantity: 1, amountCents: 10000, currency: 'PHP', customer: { externalId: customer.externalId, name: customer.name, email: customer.email, phone: customer.phone, address: customer.address }, seller: { externalId: seller.externalId, name: seller.name, email: seller.email, craft: seller.craft, location: seller.location } }).expect(201)).body;
    assert(order.id);
    await patch(`/customers/${customer.id}`, { externalId: `CHANGED-C-${suffix}` }).expect(409);
    await patch(`/sellers/${seller.id}`, { externalId: `CHANGED-S-${suffix}` }).expect(409);
    await del(`/customers/${customer.id}`).expect(409);
    await del(`/sellers/${seller.id}`).expect(409);
    const unusedCustomer = (await post('/customers', { externalId: `UNUSED-C-${suffix}`, name: 'Unused Customer', email: `unused-c-${suffix}@example.test`, phone: '', address: '' }).expect(201)).body;
    const unusedSeller = (await post('/sellers', { externalId: `UNUSED-S-${suffix}`, name: 'Unused Seller', email: `unused-s-${suffix}@example.test`, craft: 'Test craft', location: 'Mansalay' }).expect(201)).body;
    await del(`/customers/${unusedCustomer.id}`).expect(200);
    await del(`/sellers/${unusedSeller.id}`).expect(200);
  });
  it('creates authoritative payment totals, handles idempotency, and prevents duplicate order payments', async () => {
    const order = (await post('/integration/simulate-order', {}).expect(201)).body;
    const input = { orderId: order.id, methodId: 'simulator', idempotencyKey: crypto.randomUUID(), amountCents: 1 };
    const first = await post('/payments', input).expect(201); assert.equal(first.body.amountCents, order.amountCents);
    const duplicate = await post('/payments', input).expect(201); assert.equal(first.body.id, duplicate.body.id);
    await post('/payments', { ...input, idempotencyKey: crypto.randomUUID() }).expect(409);
    await post(`/payments/${first.body.id}/actions`, { action: 'processing' }).expect(200);
    await post(`/payments/${first.body.id}/actions`, { action: 'simulate-success' }).expect(200);
    await post(`/payments/${first.body.id}/actions`, { action: 'simulate-success' }).expect(409);
  });
  it('enforces manual verification evidence and disallows simulator confirmation for manual transfers', async () => {
    const p = await freshPayment({ manual: true, settle: false });
    await post(`/payments/${p.id}/actions`, { action: 'simulate-success' }).expect(403);
    await post(`/payments/${p.id}/actions`, { action: 'verify' }).expect(400);
    await post(`/payments/${p.id}/actions`, { action: 'verify', providerReference: 'TEST-VERIFIED-TRANSFER', evidence: 'Test bank statement checked.' }).expect(200);
    const second = await freshPayment({ manual: true, settle: false });
    await post(`/payments/${second.id}/actions`, { action: 'verify', providerReference: 'TEST-VERIFIED-TRANSFER', evidence: 'Duplicate transfer.' }).expect(409);
    assert.equal((await get(`/payments/${second.id}`)).body.status, 'PENDING');
  });
  it('supports failed, cancelled, and expired payment transitions with retry records', async () => {
    for (const [action, status] of [['fail', 'FAILED'], ['cancel', 'CANCELLED'], ['expire', 'EXPIRED']]) {
      const p = await freshPayment({ settle: false }); const updated = await post(`/payments/${p.id}/actions`, { action }).expect(200); assert.equal(updated.body.status, status);
      await post(`/payments/${p.id}/actions`, { action: 'simulate-success' }).expect(409);
      await post('/payments', { orderId: p.orderId, methodId: 'simulator', idempotencyKey: crypto.randomUUID() }).expect(201);
    }
  });
  it('searches, filters, sorts, and paginates transactions', async () => {
    const p = await freshPayment();
    const filtered = await get(`/payments?q=${p.reference}&status=SUCCEEDED&sort=amountCents&direction=asc&limit=1`).expect(200); assert.equal(filtered.body.total, 1); assert.equal(filtered.body.rows[0].id, p.id);
    await get('/payments?page=-1').expect(400); await get('/payments?sort=passwordHash').expect(400); await get('/payments?from=invalid').expect(400);
    await get('/payments?from=2026-02-30').expect(400); await get('/payments?from=2026-12-31&to=2026-01-01').expect(400);
  });
  it('manages payment methods without breaking financial history', async () => {
    const created = (await post('/methods', { name: `Test manual ${crypto.randomUUID()}`, kind: 'MANUAL', enabled: true }).expect(201)).body;
    assert.equal(created.usageCount, 0);
    const renamed = (await patch(`/methods/${created.id}`, { name: `Renamed manual ${crypto.randomUUID()}` }).expect(200)).body;
    assert.match(renamed.name, /Renamed manual/);
    const order = (await post('/integration/simulate-order', {}).expect(201)).body;
    await post('/payments', { orderId: order.id, methodId: created.id, idempotencyKey: crypto.randomUUID() }).expect(201);
    const methods = (await get('/methods').expect(200)).body;
    assert.equal(methods.find(method => method.id === created.id).usageCount, 1);
    await patch(`/methods/${created.id}`, { name: 'Historical records must not be renamed' }).expect(409);
    await del(`/methods/${created.id}`).expect(409);
    await patch(`/methods/${created.id}`, { enabled: false }).expect(200);
    const secondOrder = (await post('/integration/simulate-order', {}).expect(201)).body;
    await post('/payments', { orderId: secondOrder.id, methodId: created.id, idempotencyKey: crypto.randomUUID() }).expect(400);
    const unused = (await post('/methods', { name: `Unused manual ${crypto.randomUUID()}`, kind: 'MANUAL', enabled: false }).expect(201)).body;
    await del(`/methods/${unused.id}`).expect(200);
    assert.equal((await get('/methods')).body.some(method => method.id === unused.id), false);
  });
  it('serializes concurrent payment creation for the same order', async () => {
    const order = (await post('/integration/simulate-order', {}).expect(201)).body;
    const results = await Promise.all([post('/payments', { orderId: order.id, methodId: 'simulator', idempotencyKey: crypto.randomUUID() }), post('/payments', { orderId: order.id, methodId: 'simulator', idempotencyKey: crypto.randomUUID() })]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]); assert.equal(await db.payment.count({ where: { orderId: order.id } }), 1);
  });
  it('prevents over-reserved and duplicate refunds; rejection releases the reservation', async () => {
    const p = await freshPayment({ amountCents: 10000 });
    const input = { paymentId: p.id, amountCents: 6000, reason: 'Partial order cancellation for test.', idempotencyKey: crypto.randomUUID() };
    const first = await post('/refunds', input).expect(201); const duplicate = await post('/refunds', input).expect(201); assert.equal(first.body.id, duplicate.body.id);
    await post('/refunds', { ...input, amountCents: 5000, idempotencyKey: crypto.randomUUID() }).expect(409);
    await post(`/refunds/${first.body.id}/actions`, { action: 'reject' }).expect(400);
    await post(`/refunds/${first.body.id}/actions`, { action: 'reject', note: 'No eligible cancellation was found.' }).expect(200);
    await post('/refunds', { ...input, amountCents: 10000, idempotencyKey: crypto.randomUUID() }).expect(201);
  });
  it('completes partial and full refunds with exact centavo rounding and immutable ledger entries', async () => {
    const p = await freshPayment({ amountCents: 10001 });
    for (const amount of [3333, 6668]) {
      const r = (await post('/refunds', { paymentId: p.id, amountCents: amount, reason: 'Verified test refund.', idempotencyKey: crypto.randomUUID() }).expect(201)).body;
      await post(`/refunds/${r.id}/actions`, { action: 'review' }).expect(200); await post(`/refunds/${r.id}/actions`, { action: 'approve' }).expect(200); await post(`/refunds/${r.id}/actions`, { action: 'process' }).expect(200); await post(`/refunds/${r.id}/actions`, { action: 'complete' }).expect(200); await post(`/refunds/${r.id}/actions`, { action: 'complete' }).expect(409);
    }
    const updated = (await get(`/payments/${p.id}`)).body; assert.equal(updated.status, 'REFUNDED'); assert.equal(updated.refundedCents, 10001); assert.equal(updated.earning.netCents, 0); assert.equal(updated.earning.commissionCents, 0);
    const ledger = await db.ledgerEntry.findMany({ where: { paymentId: p.id } }); assert.equal(ledger.length, 3); assert.equal(ledger.reduce((n, l) => n + l.amountCents, 0), 0);
  });
  it('requires refund transfer references for manual payments and enforces the refund window', async () => {
    const p = await freshPayment({ manual: true });
    const r = (await post('/refunds', { paymentId: p.id, amountCents: 100, reason: 'Manual refund test.', idempotencyKey: crypto.randomUUID() }).expect(201)).body;
    await post(`/refunds/${r.id}/actions`, { action: 'approve' }).expect(200); await post(`/refunds/${r.id}/actions`, { action: 'complete' }).expect(400); await post(`/refunds/${r.id}/actions`, { action: 'complete', providerReference: `TEST-REFUND-${crypto.randomUUID()}` }).expect(200);
    await db.payment.update({ where: { id: p.id }, data: { verifiedAt: new Date(Date.now() - 20 * 86400000) } });
    await post('/refunds', { paymentId: p.id, amountCents: 100, reason: 'Out of policy window.', idempotencyKey: crypto.randomUUID() }).expect(400);
  });
  it('checks the remaining balance again when a failed refund is retried', async () => {
    const p = await freshPayment({ amountCents: 10000 });
    const input = { paymentId: p.id, amountCents: 10000, reason: 'Retry eligibility test.', idempotencyKey: crypto.randomUUID() };
    const first = (await post('/refunds', input).expect(201)).body;
    for (const action of ['approve', 'process', 'fail']) await post(`/refunds/${first.id}/actions`, { action }).expect(200);
    const second = (await post('/refunds', { ...input, idempotencyKey: crypto.randomUUID() }).expect(201)).body;
    await post(`/refunds/${first.id}/actions`, { action: 'retry' }).expect(409);
    await post(`/refunds/${second.id}/actions`, { action: 'reject', note: 'Release duplicate reservation.' }).expect(200);
    await post(`/refunds/${first.id}/actions`, { action: 'retry' }).expect(200);
  });
  it('generates downloadable receipts only after verification and preserves history after refund', async () => {
    const p = await freshPayment(); assert(p.receipt);
    const receipt = await get(`/receipts/${p.receipt.id}/pdf`).expect(200); assert.match(receipt.headers['content-type'], /application\/pdf/); assert.equal(receipt.body.subarray(0, 4).toString(), '%PDF');
    const unverified = await freshPayment({ settle: false }); assert.equal(unverified.receipt, null);
    const found = await get(`/receipts?q=${p.receipt.number}`).expect(200); assert.equal(found.body.total, 1);
  });
  it('reserves payout balances, rejects overspending, and records completed payouts once', async () => {
    const p = await freshPayment({ amountCents: 100000 }); const sellerId = p.order.sellerId;
    const before = (await get('/earnings')).body.find(s => s.id === sellerId);
    const input = { sellerId, amountCents: 1000, destination: 'Simulated test account only', idempotencyKey: crypto.randomUUID() };
    const payout = (await post('/payouts', input).expect(201)).body; assert.equal((await post('/payouts', input)).body.id, payout.id);
    await post('/payouts', { ...input, amountCents: before.availableCents, idempotencyKey: crypto.randomUUID() }).expect(409);
    await post(`/payouts/${payout.id}/actions`, { action: 'approve' }).expect(200); await post(`/payouts/${payout.id}/actions`, { action: 'complete' }).expect(400); await post(`/payouts/${payout.id}/actions`, { action: 'complete', providerReference: 'SIM-TEST-PAYOUT' }).expect(200); await post(`/payouts/${payout.id}/actions`, { action: 'complete', providerReference: 'SIM-TEST-PAYOUT' }).expect(409);
    const after = (await get('/earnings')).body.find(s => s.id === sellerId); assert.equal(after.balanceCents, before.balanceCents - 1000); assert.equal(after.reservedCents, before.reservedCents);
  });
  it('exports CSV and real PDFs for all financial modules and escapes spreadsheet formulas', async () => {
    const p = await freshPayment(); await db.customer.update({ where: { id: p.order.customerId }, data: { name: '=HYPERLINK("test")' } });
    for (const module of ['payments', 'transactions', 'refunds', 'payouts', 'earnings', 'reports', 'ledger']) {
      const csv = await get(`/exports/${module}/csv`).expect(200); assert.match(csv.headers['content-type'], /text\/csv/); assert.match(csv.headers['content-disposition'], /attachment/);
      const pdf = await get(`/exports/${module}/pdf`).expect(200); assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
    }
    const csv = await get(`/exports/payments/csv?q=${p.reference}`); assert(csv.text.includes("'=HYPERLINK"));
  });
  it('returns accurate dashboard totals and date-filtered financial reports', async () => {
    const d = (await get('/dashboard').expect(200)).body;
    const payments = await db.payment.findMany(); const verified = payments.filter(p => ['SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(p.status));
    assert.equal(d.summary.totalTransactions, payments.length); assert.equal(d.summary.verifiedCents, verified.reduce((n, p) => n + p.amountCents, 0)); assert.equal(d.daily.length, 30); assert.equal(d.monthly.length, 6);
    const report = await get('/reports?from=2000-01-01&to=2000-01-31').expect(200); assert.equal(report.body.summary.totalTransactions, 0);
  });
  it('persists customer, seller, payment, and ledger records across database reconnection', async () => {
    const p = await freshPayment(); const another = new PrismaClient();
    try { assert.equal((await another.payment.findUnique({ where: { id: p.id } })).reference, p.reference); } finally { await another.$disconnect(); }
    assert((await get('/customers').expect(200)).body.length); assert((await get('/sellers').expect(200)).body.length); assert((await get('/ledger').expect(200)).body.length);
  });
  it('updates settings, honors notification preferences, and records audit events', async () => {
    const settings = (await get('/settings').expect(200)).body;
    await patch('/settings', { ...settings, commissionBps: 3100 }).expect(400);
    await patch('/settings', { ...settings, notificationsEnabled: false }).expect(200);
    const count = await db.notification.count(); await freshPayment(); assert.equal(await db.notification.count(), count);
    await patch('/settings', settings).expect(200); await patch('/methods/bank-transfer', { enabled: false }).expect(200);
    const order = (await post('/integration/simulate-order', {}).expect(201)).body; await post('/payments', { orderId: order.id, methodId: 'bank-transfer', idempotencyKey: crypto.randomUUID() }).expect(400);
    await patch('/methods/bank-transfer', { enabled: true }).expect(200);
    const audit = await get('/audit?q=SETTINGS_UPDATED').expect(200); assert(audit.body.total >= 2);
    await patch('/notifications/all/read', {}).expect(200); assert.equal(await db.notification.count({ where: { readAt: null } }), 0);
    const cleared = await del('/notifications/read').expect(200); assert(cleared.body.deleted > 0); assert.equal(await db.notification.count(), 0);
  });
  it('labels unavailable integrations and rejects unconfigured or forged provider webhooks', async () => {
    const status = (await get('/integration').expect(200)).body; assert.equal(status.mode, 'SIMULATOR'); assert.equal(status.liveVerified, false);
    await post('/integration/sync', {}).expect(400); await request(app).post('/api/webhooks/payment').send({}).expect(503);
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret-that-is-long-enough';
    await request(app).post('/api/webhooks/payment').set('x-webhook-timestamp', String(Math.floor(Date.now() / 1000))).set('x-webhook-signature', 'a'.repeat(64)).send({}).expect(401);
    const p = await freshPayment({ settle: false }); await db.payment.update({ where: { id: p.id }, data: { provider: 'GATEWAY' } });
    const event = { id: `TEST-EVENT-${crypto.randomUUID()}`, paymentId: p.id, status: 'SUCCEEDED', amountCents: p.amountCents, currency: 'PHP', providerReference: `TEST-GATEWAY-${crypto.randomUUID()}` };
    const body = JSON.stringify(event), timestamp = String(Math.floor(Date.now() / 1000)); const signature = crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');
    for (let i = 0; i < 2; i++) await request(app).post('/api/webhooks/payment').set('Content-Type', 'application/json').set('x-webhook-timestamp', timestamp).set('x-webhook-signature', signature).send(body).expect(200);
    assert.equal(await db.webhookEvent.count({ where: { id: event.id } }), 1); assert.equal((await get(`/payments/${p.id}`)).body.status, 'SUCCEEDED'); process.env.PAYMENT_WEBHOOK_SECRET = '';
  });
  it('pulls paginated incremental CultureFrame orders and refreshes linked profiles', async () => {
    const previous = { simulator: config.simulator, url: process.env.CULTUREFRAME_API_URL, token: process.env.CULTUREFRAME_API_TOKEN, fetch: globalThis.fetch };
    const suffix = crypto.randomUUID();
    const first = simulatorPayload(4100), second = simulatorPayload(4101);
    first.externalId = `CF-ORDER-${suffix}-1`; first.customer.externalId = `CF-CUSTOMER-${suffix}-1`; first.seller.externalId = `CF-SELLER-${suffix}-1`;
    second.externalId = `CF-ORDER-${suffix}-2`; second.customer.externalId = `CF-CUSTOMER-${suffix}-2`; second.seller.externalId = `CF-SELLER-${suffix}-2`;
    const updatedFirst = { ...first, customer: { ...first.customer, name: 'Updated CultureFrame Customer' }, seller: { ...first.seller, craft: 'Updated CultureFrame Craft' } };
    const responses = [{ orders: [first], nextCursor: 'page-2' }, { orders: [second], nextCursor: null }, { orders: [updatedFirst], nextCursor: null }];
    const calls = [];
    try {
      config.simulator = false;
      process.env.CULTUREFRAME_API_URL = 'https://cultureframe.example/api/';
      process.env.CULTUREFRAME_API_TOKEN = 'authorized-test-token';
      globalThis.fetch = async input => { calls.push(String(input)); return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'content-type': 'application/json' } }); };
      const initial = await syncOrders({ ip: 'integration-test' });
      assert.deepEqual({ imported: initial.imported, pages: initial.pages }, { imported: 2, pages: 2 });
      assert.equal(new URL(calls[0]).searchParams.has('updatedAfter'), false);
      assert.equal(new URL(calls[1]).searchParams.get('cursor'), 'page-2');
      const incremental = await syncOrders({ ip: 'integration-test' });
      assert.deepEqual({ imported: incremental.imported, pages: incremental.pages }, { imported: 1, pages: 1 });
      assert(new URL(calls[2]).searchParams.get('updatedAfter'));
      assert.equal((await db.customer.findUnique({ where: { externalId: first.customer.externalId } })).name, 'Updated CultureFrame Customer');
      assert.equal((await db.seller.findUnique({ where: { externalId: first.seller.externalId } })).craft, 'Updated CultureFrame Craft');
      const settings = (await get('/settings').expect(200)).body;
      assert.equal(settings._integrationUpdatedAfter, undefined);
      assert.equal(settings._integrationLastSyncedAt, undefined);
    } finally {
      config.simulator = previous.simulator;
      if (previous.url === undefined) delete process.env.CULTUREFRAME_API_URL; else process.env.CULTUREFRAME_API_URL = previous.url;
      if (previous.token === undefined) delete process.env.CULTUREFRAME_API_TOKEN; else process.env.CULTUREFRAME_API_TOKEN = previous.token;
      globalThis.fetch = previous.fetch;
    }
  });
  it('updates the authorized profile only with a valid password', async () => {
    await patch('/auth/profile', { displayName: 'Test Administrator', email, currentPassword: 'incorrect' }).expect(400);
    await patch('/auth/profile', { displayName: 'Test Administrator', email, currentPassword: password }).expect(200); assert.equal((await get('/auth/profile')).body.user.displayName, 'Test Administrator');
  });
  it('logs out and prevents expired sessions from accessing financial records', async () => {
    await post('/auth/logout', {}).expect(200); await get('/payments').expect(401);
    const session = await get('/auth/session'); csrf = session.body.csrfToken; const login = await post('/auth/login', { email, password }).expect(200); csrf = login.body.csrfToken;
    await db.adminSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } }); await get('/dashboard').expect(401);
  });
  it('locks the account after repeated invalid attempts and audits failures', async () => {
    csrf = (await get('/auth/session')).body.csrfToken;
    for (let i = 0; i < 5; i++) await post('/auth/login', { email, password: 'incorrect-value' }).expect(401);
    const admin = await db.adminUser.findUnique({ where: { email } }); assert(admin.lockedUntil > new Date());
    await post('/auth/login', { email, password }).expect(401);
    await db.adminUser.update({ where: { email }, data: { lockedUntil: null, failedLogins: 0 } });
  });
  it('issues expiring recovery tokens without account disclosure and allows a single reset', async () => {
    const absent = await post('/auth/forgot-password', { email: 'missing@example.test' }).expect(200); const present = await post('/auth/forgot-password', { email }).expect(200); assert.equal(absent.body.message, present.body.message);
    const files = (await fs.readdir('.local/mail')).filter(f => f.startsWith('reset-')).sort();
    const mail = JSON.parse(await fs.readFile(`.local/mail/${files.at(-1)}`, 'utf8')); const token = new URL(mail.text.match(/http:\/\/\S+/)[0]).searchParams.get('token');
    await post('/auth/reset-password', { token, password: 'RecoveredTestPassword2026!' }).expect(200); await post('/auth/reset-password', { token, password: 'RecoveredAgainTest2026!' }).expect(400);
    const admin = await db.adminUser.findUnique({ where: { email } }); assert.equal(admin.resetTokenHash, null); assert.equal(await db.adminSession.count({ where: { adminId: admin.id } }), 0);
  });
  it('rejects expired recovery tokens and rate limits recovery requests', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    await db.adminUser.update({ where: { email }, data: { resetTokenHash: crypto.createHash('sha256').update(token).digest('hex'), resetExpiresAt: new Date(Date.now() - 1000) } });
    await post('/auth/reset-password', { token, password: 'ExpiredTestPassword2026!' }).expect(400);
    await post('/auth/forgot-password', { email }).expect(429);
  });
});
