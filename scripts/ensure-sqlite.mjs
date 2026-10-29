import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
const url = process.env.DATABASE_URL || '';
if (url.startsWith('file:')) {
  const filename = path.resolve('prisma', url.slice(5));
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  if (!fs.existsSync(filename)) fs.writeFileSync(filename, Buffer.alloc(0));
}
