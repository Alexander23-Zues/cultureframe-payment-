import fs from 'node:fs';
let schema = fs.readFileSync('prisma/schema.prisma', 'utf8').replace('provider = "sqlite"', 'provider = "mysql"');
schema = schema.split('\n').map(line => {
  const name = line.trim().split(/\s+/)[0];
  if (/^\s*\w+\s+String/.test(line)) {
    if (['data', 'payload', 'details', 'value'].includes(name)) return `${line} @db.LongText`;
    if (['evidence', 'reason', 'decisionReason', 'note', 'description', 'error', 'address', 'destination'].includes(name)) return `${line} @db.VarChar(2000)`;
  }
  return line;
}).join('\n');
fs.mkdirSync('prisma/mysql', { recursive: true });
fs.writeFileSync('prisma/mysql/schema.prisma', schema);
