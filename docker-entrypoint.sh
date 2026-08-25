#!/bin/sh
set -e

echo "[docker] Waiting for database..."
node -e "
const { URL } = require('node:url');
const net = require('node:net');
const raw = process.env.DATABASE_URL;
if (!raw) { console.error('DATABASE_URL missing'); process.exit(1); }
const u = new URL(raw);
const host = u.hostname;
const port = Number(u.port || 5432);
const start = Date.now();
function tryOnce() {
  const sock = net.connect({ host, port }, () => { sock.end(); process.exit(0); });
  sock.on('error', () => {
    sock.destroy();
    if (Date.now() - start > 60000) { console.error('Database not reachable'); process.exit(1); }
    setTimeout(tryOnce, 1500);
  });
}
tryOnce();
"

echo "[docker] Applying schema (prisma db push)..."
npx prisma db push

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[docker] Seeding..."
  npx tsx prisma/seed.ts
fi

echo "[docker] Starting aggregator on port ${PORT:-3010}"
exec node dist/index.js
