#!/bin/sh
# Single-container process supervisor for Render's free web tier.
# API already mounts AI hot-path routes; nginx fans out SSE to a local replica.
set -eu

API_PORT=8787
SSE_PORT=8789

mkdir -p /tmp/recordings

echo "Applying database migrations..."
node apps/api/dist/db-push.js

echo "Checking database seed status..."
if node --input-type=module -e "
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const { rowCount } = await pool.query('select 1 from users limit 1');
  process.exit(rowCount > 0 ? 0 : 1);
} finally {
  await pool.end();
}
"; then
  echo "Database already seeded."
else
  echo "Seeding database..."
  node apps/api/dist/db-seed.js
fi

PORT="$API_PORT" node apps/api/dist/index.js &
api_pid=$!

PORT="$SSE_PORT" node apps/sse-gateway/dist/index.js &
sse_pid=$!

node apps/worker/dist/index.js &
worker_pid=$!

terminate() {
  kill "$api_pid" "$sse_pid" "$worker_pid" 2>/dev/null || true
  wait "$api_pid" "$sse_pid" "$worker_pid" 2>/dev/null || true
}

trap terminate INT TERM

LISTEN_PORT="${PORT:-10000}"
sed "s/__LISTEN_PORT__/${LISTEN_PORT}/g" /etc/nginx/nginx.free.conf > /tmp/nginx.free.conf

# nginx stays in the foreground so Render health checks hit the edge.
exec nginx -c /tmp/nginx.free.conf -g 'daemon off;'
