import { atomic } from './db.js';
import { fail, reference, config } from './config.js';

export const paymentInclude = { order: { include: { customer: true, seller: true } }, method: true, receipt: true, refunds: true };
export const settledStatuses = ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'];
export const activeRefunds = ['REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'PROCESSING', 'COMPLETED'];
export const activePayouts = ['REQUESTED', 'APPROVED', 'PROCESSING'];
export async function audit(tx, actor, action, entity, entityId, details = '') {
  return tx.auditLog.create({ data: { adminId: actor?.id || null, ip: actor?.ip || 'system', action, entity, entityId, details: typeof details === 'string' ? details : JSON.stringify(details) } });
}
export async function notify(tx, type, title, message) {
  const enabled = await tx.systemSetting.findUnique({ where: { key: 'notificationsEnabled' } });
  if (enabled?.value === 'false') return null;
  return tx.notification.create({ data: { type, title, message } });
}
export async function enqueueSync(tx, operation, externalId, payload) {
  return tx.integrationLog.create({ data: { direction: 'OUTBOUND', operation, externalId, payload: JSON.stringify(payload), status: config.simulator ? 'SIMULATED' : 'PENDING' } });
}
async function setting(tx, key, fallback) { const row = await tx.systemSetting.findUnique({ where: { key } }); return row ? JSON.parse(row.value) : fallback; }
async function paymentLock(tx, payment) {
  const result = await tx.payment.updateMany({ where: { id: payment.id, version: payment.version }, data: { version: { increment: 1 } } });
  fail(!result.count, 409, 'Payment changed. Refresh and try again.');
}
async function refundLock(tx, refund) {
  const result = await tx.refund.updateMany({ where: { id: refund.id, version: refund.version }, data: { version: { increment: 1 } } });
  fail(!result.count, 409, 'Refund changed. Refresh and try again.');
}
export async function createPayment(input, actor) {
  return atomic(async tx => {
    const duplicate = await tx.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (duplicate) { fail(duplicate.orderId !== input.orderId || duplicate.methodId !== input.methodId, 409, 'Idempotency key belongs to another request.'); return duplicate; }
    const order = await tx.order.findUnique({ where: { id: input.orderId }, include: { payments: true } });
    fail(!order, 404, 'Order not found.');
    fail(order.payments.some(p => !['FAILED', 'CANCELLED', 'EXPIRED'].includes(p.status)), 409, 'This order already has an active or settled payment.');
    const method = await tx.paymentMethod.findUnique({ where: { id: input.methodId } });
    fail(!method?.enabled, 400, 'Payment method is unavailable.');
    fail(method.kind === 'SIMULATOR' && (!config.simulator || order.source !== 'SIMULATOR'), 400, 'Simulation is restricted to simulator orders.');
    const payment = await tx.payment.create({ data: { reference: reference('PAY'), orderId: order.id, methodId: method.id, amountCents: order.amountCents, provider: method.kind, evidence: input.evidence || '', idempotencyKey: input.idempotencyKey, commissionBps: await setting(tx, 'commissionBps', 500), feeCents: 0 } });
    await tx.paymentAttempt.create({ data: { paymentId: payment.id, status: 'PENDING', note: 'Authorized payment record created from stored order total.' } });
    await notify(tx, 'PAYMENT', 'New payment request', `${payment.reference} is awaiting verification.`);
    await audit(tx, actor, 'PAYMENT_CREATED', 'payment', payment.id, { order: order.externalId, amountCents: payment.amountCents });
    return payment;
  });
}
export async function settlePayment(tx, payment, actor, providerReference, evidence) {
  fail(!['PENDING', 'PROCESSING'].includes(payment.status), 409, 'Only pending or processing payments can be verified.');
  await paymentLock(tx, payment);
  const order = await tx.order.findUnique({ where: { id: payment.orderId } });
  const commission = Math.round(payment.amountCents * payment.commissionBps / 10000);
  const net = payment.amountCents - commission - payment.feeCents;
  await tx.payment.update({ where: { id: payment.id }, data: { status: 'SUCCEEDED', verifiedAt: new Date(), providerReference, evidence: evidence || payment.evidence } });
  await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID' } });
  await tx.receipt.create({ data: { paymentId: payment.id, number: reference('RCPT') } });
  await tx.sellerEarning.create({ data: { sellerId: order.sellerId, paymentId: payment.id, grossCents: payment.amountCents, commissionCents: commission, feeCents: payment.feeCents, netCents: net } });
  await tx.ledgerEntry.create({ data: { sellerId: order.sellerId, paymentId: payment.id, kind: 'SALE', amountCents: net, reference: `sale:${payment.id}`, description: `Net sale for ${payment.reference}` } });
  await tx.paymentEvent.create({ data: { paymentId: payment.id, type: 'VERIFIED', source: payment.provider, reference: providerReference } });
  await notify(tx, 'PAYMENT', 'Payment verified', `${payment.reference} has been verified. A receipt is available.`);
  await audit(tx, actor, 'PAYMENT_VERIFIED', 'payment', payment.id, { providerReference, provider: payment.provider });
  await enqueueSync(tx, 'PAYMENT_STATUS', order.externalId, { paymentReference: payment.reference, status: 'SUCCEEDED', amountCents: payment.amountCents, providerReference });
}
export async function paymentAction(id, input, actor) {
  return atomic(async tx => {
    const payment = await tx.payment.findUnique({ where: { id }, include: { order: true } });
    fail(!payment, 404, 'Payment not found.');
    if (input.action === 'verify' || input.action === 'simulate-success') {
      const simulation = input.action === 'simulate-success';
      fail(simulation && (!config.simulator || payment.provider !== 'SIMULATOR' || payment.order.source !== 'SIMULATOR'), 403, 'Only simulator payments may be simulated.');
      fail(!simulation && payment.provider !== 'MANUAL', 400, 'Gateway payments require a verified provider event.');
      fail(!simulation && (!input.providerReference?.trim() || !input.evidence?.trim()), 400, 'Provide the verified transfer reference and verification evidence.');
      await settlePayment(tx, payment, actor, simulation ? reference('SIM') : input.providerReference, simulation ? 'Local simulator confirmation; no funds moved.' : input.evidence);
    } else {
      const status = { processing: 'PROCESSING', fail: 'FAILED', cancel: 'CANCELLED', expire: 'EXPIRED' }[input.action];
      fail(!status || !['PENDING', 'PROCESSING'].includes(payment.status), 409, 'This payment cannot make that status transition.');
      fail(payment.provider === 'GATEWAY', 400, 'Gateway state must come from its provider.');
      await paymentLock(tx, payment);
      await tx.payment.update({ where: { id }, data: { status } });
      await tx.paymentEvent.create({ data: { paymentId: id, type: status, source: 'ADMIN', reference: reference('EVT') } });
      await audit(tx, actor, `PAYMENT_${status}`, 'payment', id, input.evidence || '');
      await notify(tx, 'PAYMENT', `Payment ${status.toLowerCase()}`, payment.reference);
    }
    return tx.payment.findUnique({ where: { id }, include: paymentInclude });
  });
}
export async function sellerBalance(tx, sellerId) {
  const [ledger, reserved] = await Promise.all([
    tx.ledgerEntry.aggregate({ where: { sellerId }, _sum: { amountCents: true } }),
    tx.sellerPayout.aggregate({ where: { sellerId, status: { in: activePayouts } }, _sum: { amountCents: true } }),
  ]);
  return { balanceCents: ledger._sum.amountCents || 0, reservedCents: reserved._sum.amountCents || 0, availableCents: (ledger._sum.amountCents || 0) - (reserved._sum.amountCents || 0) };
}
export async function createRefund(input, actor) {
  return atomic(async tx => {
    const existing = await tx.refund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) { fail(existing.paymentId !== input.paymentId || existing.amountCents !== input.amountCents, 409, 'Idempotency key belongs to another request.'); return existing; }
    const payment = await tx.payment.findUnique({ where: { id: input.paymentId }, include: { refunds: true } });
    fail(!payment || !['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(payment.status), 400, 'A verified, refundable payment is required.');
    const windowDays = await setting(tx, 'refundDays', 14);
    fail(!payment.verifiedAt || Date.now() - new Date(payment.verifiedAt).getTime() > windowDays * 86400000, 400, 'The payment is outside the configured refund request window.');
    await paymentLock(tx, payment);
    const reserved = payment.refunds.filter(r => activeRefunds.includes(r.status)).reduce((sum, r) => sum + r.amountCents, 0);
    fail(input.amountCents > payment.amountCents - reserved, 409, 'Requested amount exceeds the unreserved refundable balance.');
    const refund = await tx.refund.create({ data: { ...input, reference: reference('RFND') } });
    await notify(tx, 'REFUND', 'Refund requested', `${refund.reference} is ready for review.`);
    await audit(tx, actor, 'REFUND_REQUESTED', 'refund', refund.id, { amountCents: input.amountCents, reason: input.reason });
    return refund;
  });
}
export async function refundAction(id, input, actor) {
  return atomic(async tx => {
    const refund = await tx.refund.findUnique({ where: { id }, include: { payment: { include: { order: true, earning: true } } } });
    fail(!refund, 404, 'Refund not found.');
    await refundLock(tx, refund);
    const transitions = { review: { from: ['REQUESTED'], to: 'UNDER_REVIEW' }, approve: { from: ['REQUESTED', 'UNDER_REVIEW'], to: 'APPROVED' }, reject: { from: ['REQUESTED', 'UNDER_REVIEW', 'APPROVED'], to: 'REJECTED' }, process: { from: ['APPROVED'], to: 'PROCESSING' }, fail: { from: ['PROCESSING'], to: 'FAILED' }, retry: { from: ['FAILED'], to: 'REQUESTED' }, complete: { from: ['APPROVED', 'PROCESSING'], to: 'COMPLETED' } };
    const change = transitions[input.action];
    fail(!change?.from.includes(refund.status), 409, 'This refund cannot make that status transition.');
    fail(input.action === 'reject' && !input.note?.trim(), 400, 'A rejection reason is required.');
    const payment = refund.payment;
    await paymentLock(tx, payment);
    if (input.action === 'retry') {
      const other = await tx.refund.aggregate({ where: { paymentId: payment.id, id: { not: id }, status: { in: activeRefunds } }, _sum: { amountCents: true } });
      fail((other._sum.amountCents || 0) + refund.amountCents > payment.amountCents, 409, 'Refund balance is already reserved.');
    }
    if (input.action === 'complete') {
      fail(payment.provider === 'GATEWAY', 400, 'Gateway refunds require verified provider confirmation.');
      fail(payment.provider === 'SIMULATOR' && !config.simulator, 403, 'Simulator is disabled.');
      fail(payment.provider === 'MANUAL' && !input.providerReference?.trim(), 400, 'Record the actual refund transfer reference.');
      const cumulative = payment.refundedCents + refund.amountCents;
      fail(cumulative > payment.amountCents, 409, 'Refund exceeds the original payment.');
      const commissionBefore = Math.round(payment.refundedCents * payment.commissionBps / 10000);
      const commissionAfter = Math.round(cumulative * payment.commissionBps / 10000);
      const sellerDeduction = refund.amountCents - (commissionAfter - commissionBefore);
      const balance = await sellerBalance(tx, payment.order.sellerId);
      fail(balance.availableCents < sellerDeduction, 409, 'Seller funds are paid out or reserved. Resolve the payout or fund the seller balance before refunding.');
      await tx.refundTransaction.create({ data: { refundId: id, providerReference: payment.provider === 'SIMULATOR' ? reference('SIM-RF') : input.providerReference, amountCents: refund.amountCents, status: 'COMPLETED' } });
      const status = cumulative === payment.amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      await tx.payment.update({ where: { id: payment.id }, data: { refundedCents: cumulative, status } });
      await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: status } });
      await tx.sellerEarning.update({ where: { paymentId: payment.id }, data: { refundCents: { increment: refund.amountCents }, netCents: { decrement: sellerDeduction }, commissionCents: { decrement: commissionAfter - commissionBefore } } });
      await tx.ledgerEntry.create({ data: { sellerId: payment.order.sellerId, paymentId: payment.id, kind: 'REFUND', amountCents: -sellerDeduction, reference: `refund:${id}`, description: `Refund deduction for ${refund.reference}` } });
      await enqueueSync(tx, 'REFUND_STATUS', payment.order.externalId, { refundReference: refund.reference, status: 'COMPLETED', amountCents: refund.amountCents });
    }
    await tx.refund.update({ where: { id }, data: { status: change.to, decisionReason: input.note || refund.decisionReason } });
    await audit(tx, actor, `REFUND_${change.to}`, 'refund', id, input.note || '');
    await notify(tx, 'REFUND', `Refund ${change.to.toLowerCase().replaceAll('_', ' ')}`, refund.reference);
    return tx.refund.findUnique({ where: { id } });
  });
}
export async function createPayout(input, actor) {
  return atomic(async tx => {
    const duplicate = await tx.sellerPayout.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (duplicate) { fail(duplicate.sellerId !== input.sellerId || duplicate.amountCents !== input.amountCents, 409, 'Idempotency key belongs to another request.'); return duplicate; }
    fail(!await tx.seller.findUnique({ where: { id: input.sellerId } }), 404, 'Seller not found.');
    // A write on the seller serializes competing reservations in MySQL and SQLite.
    await tx.seller.update({ where: { id: input.sellerId }, data: { location: (await tx.seller.findUnique({ where: { id: input.sellerId } })).location } });
    const balance = await sellerBalance(tx, input.sellerId);
    fail(input.amountCents > balance.availableCents, 409, 'Payout exceeds available seller earnings.');
    const payout = await tx.sellerPayout.create({ data: { ...input, reference: reference('OUT') } });
    await audit(tx, actor, 'PAYOUT_REQUESTED', 'payout', payout.id, { amountCents: input.amountCents });
    return payout;
  });
}
export async function payoutAction(id, input, actor) {
  return atomic(async tx => {
    const payout = await tx.sellerPayout.findUnique({ where: { id } });
    fail(!payout, 404, 'Payout not found.');
    const transitions = { approve: { from: ['REQUESTED'], to: 'APPROVED' }, process: { from: ['APPROVED'], to: 'PROCESSING' }, reject: { from: ['REQUESTED', 'APPROVED'], to: 'REJECTED' }, complete: { from: ['APPROVED', 'PROCESSING'], to: 'COMPLETED' } };
    const change = transitions[input.action];
    fail(!change?.from.includes(payout.status), 409, 'This payout cannot make that status transition.');
    fail(input.action === 'reject' && !input.note?.trim(), 400, 'A rejection reason is required.');
    fail(input.action === 'complete' && !input.providerReference?.trim(), 400, 'Record the actual transfer reference (or SIM- prefix for a simulator seller).');
    if (input.action === 'complete') {
      const seller = await tx.seller.findUnique({ where: { id: payout.sellerId } });
      fail(seller.source === 'SIMULATOR' && !input.providerReference.startsWith('SIM-'), 400, 'Simulator payout references must begin with SIM-.');
      const balance = await sellerBalance(tx, payout.sellerId);
      fail(balance.balanceCents < payout.amountCents, 409, 'Seller balance is insufficient.');
      await tx.ledgerEntry.create({ data: { sellerId: payout.sellerId, payoutId: id, kind: 'PAYOUT', amountCents: -payout.amountCents, reference: `payout:${id}`, description: `Payout ${payout.reference} · ${input.providerReference}` } });
    }
    const result = await tx.sellerPayout.updateMany({ where: { id, version: payout.version }, data: { status: change.to, version: { increment: 1 }, note: input.note || payout.note, ...(input.action === 'complete' ? { providerReference: input.providerReference } : {}) } });
    fail(!result.count, 409, 'Payout changed. Refresh and try again.');
    await audit(tx, actor, `PAYOUT_${change.to}`, 'payout', id, input.providerReference || input.note || '');
    await notify(tx, 'PAYOUT', `Payout ${change.to.toLowerCase()}`, payout.reference);
    return tx.sellerPayout.findUnique({ where: { id } });
  });
}
