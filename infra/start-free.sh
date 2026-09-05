#!/bin/sh

set -eu

API_PORT=8787
SSE_PORT=8789

EDGE_PORT="${PORT:-10000}"

mkdir -p /tmp/recordings

echo "Applying database migrations..."
if ! node apps/api/dist/db-push.js; then
  echo "Database migration failed; retrying once after 3s..." >&2
  sleep 3
  node apps/api/dist/db-push.js
fi

echo "Checking database seed status..."
if node --input-type=module -e "
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const { rowCount } = await pool.query('select 1 from products limit 1');
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

env PORT="$API_PORT" node apps/api/dist/index.js &
api_pid=$!

env PORT="$SSE_PORT" node apps/sse-gateway/dist/index.js &
sse_pid=$!

node apps/worker/dist/index.js &
worker_pid=$!

echo "Waiting for API on port ${API_PORT}..."
ready=0
attempt=0
while [ "$attempt" -lt 90 ]; do
  if curl -fsS "http://127.0.0.1:${API_PORT}/api/health/live" >/dev/null 2>&1; then
    ready=1
    break
  fi
  attempt=$((attempt + 1))
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo "API did not become ready on port ${API_PORT}" >&2
  exit 1
fi
echo "API ready."

terminate() {
  kill "$api_pid" "$sse_pid" "$worker_pid" 2>/dev/null || true
  wait "$api_pid" "$sse_pid" "$worker_pid" 2>/dev/null || true
}

trap terminate INT TERM

sed "s/__LISTEN_PORT__/${EDGE_PORT}/g" /etc/nginx/nginx.conf > /tmp/nginx.conf

exec nginx -c /tmp/nginx.conf -g 'daemon off;'
