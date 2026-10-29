import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import fs from 'node:fs/promises';
import { db, atomic } from './db.js';
import { audit } from './domain.js';
import { config, fail } from './config.js';

export const auth = Router();
export const actor = req => ({ id: req.admin?.id, ip: req.ip });
export const safeAdmin = admin => ({ id: admin.id, email: admin.email, displayName: admin.displayName, role: admin.role, mustChangePassword: admin.mustChangePassword });
const tokenHash = value => crypto.createHash('sha256').update(value).digest('hex');
const dummyHash = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);
const email = z.string().trim().toLowerCase().email().max(190);
const newPassword = z.string().min(12, 'Use at least 12 characters.').max(72, 'Use no more than 72 characters.').refine(v => Buffer.byteLength(v, 'utf8') <= 72, 'Password must not exceed 72 UTF-8 bytes.').refine(v => /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v), 'Include uppercase, lowercase, and a number.');
const save = req => new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
const regenerate = req => new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
const destroy = req => new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
const authLimit = rateLimit({ windowMs: 15 * 60000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts. Please try again in 15 minutes.' } });
const recoveryLimit = rateLimit({ windowMs: 3600000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many recovery attempts. Please try again later.' } });
export async function requireAdmin(req, res, next) {
  fail(!req.session.adminId, 401, 'Please sign in to continue.');
  const admin = await db.adminUser.findUnique({ where: { id: req.session.adminId } });
  fail(!admin || admin.role !== 'SUPER_ADMIN', 403, 'Access is restricted to authorized administrators.');
  req.admin = admin;
  next();
}
export function requireChangedPassword(req, res, next) { fail(req.admin.mustChangePassword, 403, 'PASSWORD_CHANGE_REQUIRED'); next(); }
export function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = req.get('x-csrf-token') || '';
  const expected = req.session.csrf || '';
  const origin = req.get('origin');
  const allowedOrigins = new Set([new URL(config.appUrl).origin]);
  if (!config.production) {
    const configured = new URL(config.appUrl);
    if (['localhost', '127.0.0.1'].includes(configured.hostname)) for (const host of ['localhost', '127.0.0.1']) allowedOrigins.add(`${configured.protocol}//${host}${configured.port ? ':' + configured.port : ''}`);
  }
  fail(origin && !allowedOrigins.has(origin), 403, 'Request origin is not allowed.');
  fail(!/^[a-f0-9]{64}$/.test(sent) || !expected || sent.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected)), 403, 'Session security token expired. Refresh and try again.');
  next();
}
auth.get('/session', async (req, res) => {
  req.session.csrf ||= crypto.randomBytes(32).toString('hex');
  const admin = req.session.adminId ? await db.adminUser.findUnique({ where: { id: req.session.adminId } }) : null;
  await save(req);
  res.json({ user: admin ? safeAdmin(admin) : null, csrfToken: req.session.csrf });
});
auth.post('/login', authLimit, async (req, res) => {
  const input = z.object({ email, password: z.string().min(1).max(72), remember: z.boolean().default(false) }).parse(req.body);
  const admin = await db.adminUser.findUnique({ where: { email: input.email } });
  const match = await bcrypt.compare(input.password, admin?.passwordHash || dummyHash);
  if (!admin || !match || (admin.lockedUntil && admin.lockedUntil > new Date())) {
    if (admin) await db.adminUser.update({ where: { id: admin.id }, data: { failedLogins: { increment: 1 }, ...(admin.failedLogins >= 4 ? { lockedUntil: new Date(Date.now() + 15 * 60000) } : {}) } });
    await audit(db, { ip: req.ip }, 'LOGIN_FAILED', 'admin', admin?.id, 'Invalid credentials or account temporarily locked.');
    return res.status(401).json({ error: 'Invalid credentials or account temporarily unavailable.' });
  }
  await regenerate(req);
  req.session.adminId = admin.id;
  req.session.csrf = crypto.randomBytes(32).toString('hex');
  req.session.cookie.maxAge = (input.remember ? 7 * 24 : 8) * 3600000;
  await db.adminUser.update({ where: { id: admin.id }, data: { failedLogins: 0, lockedUntil: null } });
  await audit(db, { id: admin.id, ip: req.ip }, 'LOGIN', 'admin', admin.id);
  await save(req);
  res.json({ user: safeAdmin(admin), csrfToken: req.session.csrf });
});
auth.post('/logout', requireAdmin, async (req, res) => {
  await audit(db, actor(req), 'LOGOUT', 'admin', req.admin.id);
  await destroy(req);
  res.clearCookie('cf.sid', { path: '/' }).json({ ok: true });
});
auth.post('/forgot-password', recoveryLimit, async (req, res) => {
  const input = z.object({ email }).parse(req.body);
  const admin = await db.adminUser.findUnique({ where: { email: input.email } });
  if (admin) {
    const token = crypto.randomBytes(32).toString('hex');
    await db.adminUser.update({ where: { id: admin.id }, data: { resetTokenHash: tokenHash(token), resetExpiresAt: new Date(Date.now() + 30 * 60000) } });
    const link = `${config.appUrl}/reset-password?token=${token}`;
    const mail = { to: admin.email, subject: 'Reset your CultureFrame administrator password', text: `Use this link within 30 minutes to reset your password:\n${link}\nIf you did not request this, ignore this message.` };
    try {
      if (process.env.SMTP_HOST) {
        const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_PORT === '465', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined });
        await transport.sendMail({ from: process.env.MAIL_FROM, ...mail });
      } else if (!config.production) {
        await fs.mkdir('.local/mail', { recursive: true });
        await fs.writeFile(`.local/mail/reset-${Date.now()}.json`, JSON.stringify(mail, null, 2), { mode: 0o600 });
      } else throw new Error('SMTP is not configured.');
      await audit(db, { ip: req.ip }, 'PASSWORD_RESET_REQUESTED', 'admin', admin.id);
    } catch { await audit(db, { ip: req.ip }, 'PASSWORD_RESET_DELIVERY_FAILED', 'admin', admin.id, 'Check SMTP configuration.'); }
  }
  res.json({ message: 'If this is an authorized account, password reset instructions will be sent. In local development, email is saved in .local/mail.' });
});
auth.post('/reset-password', recoveryLimit, async (req, res) => {
  const input = z.object({ token: z.string().length(64), password: newPassword }).parse(req.body);
  const hash = tokenHash(input.token);
  const passwordHash = await bcrypt.hash(input.password, 12);
  await atomic(async tx => {
    const admin = await tx.adminUser.findUnique({ where: { resetTokenHash: hash } });
    fail(!admin || !admin.resetExpiresAt || admin.resetExpiresAt < new Date(), 400, 'The reset link is invalid or expired.');
    const changed = await tx.adminUser.updateMany({ where: { id: admin.id, resetTokenHash: hash, resetExpiresAt: { gt: new Date() } }, data: { passwordHash, resetTokenHash: null, resetExpiresAt: null, mustChangePassword: false, failedLogins: 0, lockedUntil: null } });
    fail(!changed.count, 400, 'The reset link is invalid or expired.');
    await tx.adminSession.deleteMany({ where: { adminId: admin.id } });
    await audit(tx, { id: admin.id, ip: req.ip }, 'PASSWORD_RESET', 'admin', admin.id);
  });
  res.json({ message: 'Password updated. Sign in with your new password.' });
});
auth.post('/change-password', requireAdmin, async (req, res) => {
  const input = z.object({ currentPassword: z.string().min(1).max(72), password: newPassword }).parse(req.body);
  fail(!await bcrypt.compare(input.currentPassword, req.admin.passwordHash), 400, 'Current password is incorrect.');
  fail(await bcrypt.compare(input.password, req.admin.passwordHash), 400, 'Choose a different password.');
  const passwordHash = await bcrypt.hash(input.password, 12);
  await atomic(async tx => {
    await tx.adminUser.update({ where: { id: req.admin.id }, data: { passwordHash, mustChangePassword: false, resetTokenHash: null, resetExpiresAt: null } });
    await tx.adminSession.deleteMany({ where: { adminId: req.admin.id } });
    await audit(tx, actor(req), 'PASSWORD_CHANGED', 'admin', req.admin.id);
  });
  await regenerate(req);
  req.session.adminId = req.admin.id;
  req.session.csrf = crypto.randomBytes(32).toString('hex');
  await save(req);
  res.json({ user: safeAdmin({ ...req.admin, mustChangePassword: false }), csrfToken: req.session.csrf });
});
auth.get('/profile', requireAdmin, async (req, res) => {
  const history = await db.auditLog.findMany({ where: { entityId: req.admin.id, action: { in: ['LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'PASSWORD_CHANGED', 'PASSWORD_RESET'] } }, orderBy: { createdAt: 'desc' }, take: 30 });
  res.json({ user: safeAdmin(req.admin), history });
});
auth.patch('/profile', requireAdmin, requireChangedPassword, async (req, res) => {
  const input = z.object({ displayName: z.string().trim().min(2).max(100), email, currentPassword: z.string().min(1).max(72) }).parse(req.body);
  fail(!await bcrypt.compare(input.currentPassword, req.admin.passwordHash), 400, 'Current password is incorrect.');
  const user = await atomic(async tx => {
    const updated = await tx.adminUser.update({ where: { id: req.admin.id }, data: { displayName: input.displayName, email: input.email } });
    await audit(tx, actor(req), 'PROFILE_UPDATED', 'admin', updated.id, { email: updated.email });
    return updated;
  });
  res.json({ user: safeAdmin(user) });
});
