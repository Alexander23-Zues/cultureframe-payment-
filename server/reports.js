import PDFDocument from 'pdfkit';
import { db } from './db.js';
import { paymentInclude, settledStatuses, activePayouts, sellerBalance } from './domain.js';
import { z } from 'zod';

export const currency = cents => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(cents / 100);
export const dayKey = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
export function dateRange(query) {
  const schema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, 'Invalid date');
  const range = {};
  if (query.from) range.gte = new Date(`${schema.parse(query.from)}T00:00:00+08:00`);
  if (query.to) range.lt = new Date(new Date(`${schema.parse(query.to)}T00:00:00+08:00`).getTime() + 86400000);
  if (range.gte && range.lt && range.gte >= range.lt) throw new z.ZodError([{ code: 'custom', path: ['to'], message: 'End date must not precede the start date.' }]);
  return Object.keys(range).length ? range : undefined;
}
export function paymentWhere(query) {
  const range = dateRange(query);
  const where = { ...(range ? { createdAt: range } : {}) };
  if (query.status) where.status = z.enum(['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'PARTIALLY_REFUNDED', 'REFUNDED']).parse(query.status);
  if (query.method) where.methodId = String(query.method).slice(0, 100);
  if (query.q) {
    const contains = String(query.q).slice(0, 150);
    where.OR = [{ reference: { contains } }, { order: { externalId: { contains } } }, { order: { product: { contains } } }, { order: { customer: { name: { contains } } } }, { order: { seller: { name: { contains } } } }];
  }
  return where;
}
export async function earningsRows() {
  const sellers = await db.seller.findMany({ include: { earnings: true, payouts: true, orders: { include: { payments: true } } }, orderBy: { name: 'asc' } });
  return Promise.all(sellers.map(async seller => ({
    ...seller,
    grossCents: seller.earnings.reduce((n, e) => n + e.grossCents, 0),
    commissionCents: seller.earnings.reduce((n, e) => n + e.commissionCents, 0),
    feeCents: seller.earnings.reduce((n, e) => n + e.feeCents, 0),
    refundCents: seller.earnings.reduce((n, e) => n + e.refundCents, 0),
    netCents: seller.earnings.reduce((n, e) => n + e.netCents, 0),
    paidCents: seller.payouts.filter(p => p.status === 'COMPLETED').reduce((n, p) => n + p.amountCents, 0),
    pendingSettlementCents: seller.orders.flatMap(o => o.payments).filter(p => ['PENDING', 'PROCESSING'].includes(p.status)).reduce((n, p) => n + p.amountCents - Math.round(p.amountCents * p.commissionBps / 10000) - p.feeCents, 0),
    ...await sellerBalance(db, seller.id),
  })));
}
export async function reportData(query = {}) {
  const range = dateRange(query);
  const [payments, refunds, payouts, ledger] = await Promise.all([
    db.payment.findMany({ where: paymentWhere(query), include: paymentInclude, orderBy: { createdAt: 'desc' } }),
    db.refund.findMany({ where: range ? { updatedAt: range } : {}, include: { payment: { include: paymentInclude } }, orderBy: { createdAt: 'desc' } }),
    db.sellerPayout.findMany({ where: range ? { updatedAt: range } : {}, include: { seller: true }, orderBy: { createdAt: 'desc' } }),
    db.ledgerEntry.findMany({ where: range ? { createdAt: range } : {}, include: { seller: true, payment: true }, orderBy: { createdAt: 'desc' } }),
  ]);
  const verified = payments.filter(p => settledStatuses.includes(p.status));
  const verifiedCents = verified.reduce((n, p) => n + p.amountCents, 0);
  const refundedCents = refunds.filter(r => r.status === 'COMPLETED').reduce((n, r) => n + r.amountCents, 0);
  const commissionCents = verified.reduce((n, p) => n + Math.round(p.amountCents * p.commissionBps / 10000), 0);
  const dates = new Map();
  for (let i = 29; i >= 0; i--) { const d = dayKey(Date.now() - i * 86400000); dates.set(d, { date: d, label: new Date(`${d}T00:00:00+08:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' }), revenue: 0, transactions: 0, refunds: 0, earnings: 0 }); }
  for (const p of payments) { const key = dayKey(p.createdAt); if (!dates.has(key)) continue; const row = dates.get(key); row.transactions++; if (settledStatuses.includes(p.status)) { row.revenue += p.amountCents / 100; row.earnings += (p.amountCents - Math.round(p.amountCents * p.commissionBps / 10000) - p.feeCents) / 100; } }
  for (const r of refunds.filter(r => r.status === 'COMPLETED')) { const row = dates.get(dayKey(r.updatedAt)); if (row) row.refunds += r.amountCents / 100; }
  const months = new Map();
  for (let i = 5; i >= 0; i--) { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); const key = dayKey(d).slice(0, 7); months.set(key, { month: key, label: d.toLocaleDateString('en-PH', { month: 'short', year: '2-digit', timeZone: 'Asia/Manila' }), revenue: 0 }); }
  for (const p of verified) { const m = months.get(dayKey(p.createdAt).slice(0, 7)); if (m) m.revenue += p.amountCents / 100; }
  const distribution = field => Object.entries(payments.reduce((a, p) => { const key = field === 'method' ? p.method.name : p.status; a[key] = (a[key] || 0) + 1; return a; }, {})).map(([name, value]) => ({ name, value }));
  return { payments, refunds, payouts, ledger, summary: { totalTransactions: payments.length, successfulPayments: verified.length, pendingPayments: payments.filter(p => ['PENDING', 'PROCESSING'].includes(p.status)).length, failedPayments: payments.filter(p => p.status === 'FAILED').length, verifiedCents, refundedCents, netCollectionsCents: verifiedCents - refundedCents, commissionCents, totalRefunds: refunds.length, completedRefunds: refunds.filter(r => r.status === 'COMPLETED').length, pendingPayoutCents: payouts.filter(p => activePayouts.includes(p.status)).reduce((n, p) => n + p.amountCents, 0), paidCents: payouts.filter(p => p.status === 'COMPLETED').reduce((n, p) => n + p.amountCents, 0), sellerEarningsCents: ledger.filter(l => ['SALE', 'REFUND'].includes(l.kind)).reduce((n, l) => n + l.amountCents, 0) }, daily: [...dates.values()], monthly: [...months.values()], statuses: distribution('status'), methods: distribution('method') };
}
const csvCell = value => {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
export function csvResponse(res, filename, headers, rows) {
  res.type('text/csv; charset=utf-8').attachment(`${filename}.csv`).send('\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n'));
}
export function pdfResponse(res, filename, title, draw, simulator = false) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: title, Author: 'CultureFrame' } });
  res.type('application/pdf').attachment(`${filename}.pdf`);
  doc.pipe(res);
  doc.fillColor('#183e34').fontSize(23).text('CultureFrame', { continued: false });
  doc.fillColor('#847653').fontSize(9).text('CULTURAL PRODUCT PAYMENT MANAGEMENT');
  doc.moveDown(1.5).fillColor('#183e34').fontSize(18).text(title);
  if (simulator) doc.moveDown(0.5).fillColor('#995719').fontSize(10).text('SIMULATOR RECORDS — DEVELOPMENT ONLY. NO REAL MONEY MOVED.');
  doc.moveDown().fillColor('#33433c').fontSize(10);
  draw(doc);
  doc.end();
}
export function pdfLines(doc, rows) { for (const row of rows) { if (doc.y > 735) { doc.addPage(); doc.y = 48; } doc.text(row, { lineGap: 4 }); } }
