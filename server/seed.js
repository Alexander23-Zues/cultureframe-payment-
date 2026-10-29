import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'node:url';
import { db } from './db.js';
import { createSimulatorOrder } from './simulator.js';
import { createPayment, paymentAction, createRefund, refundAction } from './domain.js';
import { config } from './config.js';
import crypto from 'node:crypto';
import { z } from 'zod';
export async function seed({ samples = true } = {}) {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!email || !z.string().email().safeParse(email).success) throw new Error('Set a valid ADMIN_EMAIL before provisioning.');
  const existing = await db.adminUser.findUnique({ where: { email } });
  if (!existing && (!password || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72)) throw new Error('Set ADMIN_INITIAL_PASSWORD (12–72 bytes) in the private environment before initial provisioning.');
  if (!existing) await db.adminUser.create({ data: { email, passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true } });
  for (const method of [ { id: 'bank-transfer', name: 'Bank transfer', kind: 'MANUAL', enabled: true }, { id: 'gcash-manual', name: 'GCash · manual verification', kind: 'MANUAL', enabled: true }, { id: 'maya-manual', name: 'Maya · manual verification', kind: 'MANUAL', enabled: true }, { id: 'simulator', name: 'Development simulator', kind: 'SIMULATOR', enabled: config.simulator } ]) await db.paymentMethod.upsert({ where: { id: method.id }, create: method, update: {} });
  for (const [key, value] of Object.entries({ organizationName: 'CultureFrame', contactEmail: email, commissionBps: 500, refundDays: 14, notificationsEnabled: true })) await db.systemSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(value) }, update: {} });
  if (samples && config.simulator && !await db.order.count()) {
    for (let i = 0; i < 36; i++) {
      const order = await createSimulatorOrder({ ip: 'development-seed' }, i);
      const p = await createPayment({ orderId: order.id, methodId: i % 7 === 0 ? 'gcash-manual' : i % 9 === 0 ? 'bank-transfer' : 'simulator', evidence: '', idempotencyKey: crypto.randomUUID() }, { ip: 'development-seed' });
      if (i < 28) await paymentAction(p.id, { action: p.provider === 'SIMULATOR' ? 'simulate-success' : 'verify', providerReference: `SIM-SEED-${i}`, evidence: 'Simulated manual transfer evidence for seeded development order; no real money moved.' }, { ip: 'development-seed' });
      else if (i < 31) await paymentAction(p.id, { action: 'fail' }, { ip: 'development-seed' });
      const createdAt = new Date(Date.now() - ((35 - i) % 30) * 86400000 - (i % 10) * 3600000);
      await db.payment.update({ where: { id: p.id }, data: { createdAt, ...(i < 28 ? { verifiedAt: createdAt } : {}) } });
      await db.order.update({ where: { id: order.id }, data: { createdAt } });
      await db.sellerEarning.updateMany({ where: { paymentId: p.id }, data: { createdAt } });
      await db.ledgerEntry.updateMany({ where: { paymentId: p.id }, data: { createdAt } });
      if ([2, 5, 23].includes(i)) {
        const refund = await createRefund({ paymentId: p.id, amountCents: i === 23 ? 20000 : p.amountCents, reason: 'Sample refund request for development review.', idempotencyKey: crypto.randomUUID() }, { ip: 'development-seed' });
        if (i === 2) { await refundAction(refund.id, { action: 'approve' }, { ip: 'development-seed' }); await refundAction(refund.id, { action: 'complete' }, { ip: 'development-seed' }); }
      }
    }
  }
  return { provisioned: !existing };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const result = await seed(); console.log(`Database ready. Administrator ${result.provisioned ? 'provisioned' : 'already exists; password unchanged'}. ${config.simulator ? 'Simulator records are clearly labeled.' : 'No sample data created.'}`); }
  finally { await db.$disconnect(); }
}
