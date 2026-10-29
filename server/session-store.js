import session from 'express-session';
import { db } from './db.js';
export class PrismaSessionStore extends session.Store {
  get(id, callback) {
    db.adminSession.findUnique({ where: { id } }).then(row => {
      callback(null, row && row.expiresAt > new Date() ? JSON.parse(row.data) : null);
    }).catch(callback);
  }
  set(id, data, callback = () => {}) {
    const value = { data: JSON.stringify(data), expiresAt: new Date(data.cookie.expires || Date.now() + 8 * 3600000), adminId: data.adminId || null };
    db.adminSession.upsert({ where: { id }, create: { id, ...value }, update: value }).then(() => callback()).catch(callback);
  }
  destroy(id, callback = () => {}) { db.adminSession.deleteMany({ where: { id } }).then(() => callback()).catch(callback); }
  touch(id, data, callback = () => {}) {
    db.adminSession.updateMany({ where: { id }, data: { expiresAt: new Date(data.cookie.expires || Date.now() + 8 * 3600000) } }).then(() => callback()).catch(callback);
  }
}
