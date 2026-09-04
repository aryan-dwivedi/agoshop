#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stackDir = join(repoRoot, '.stack');
const nginxConfPath = join(stackDir, 'nginx.conf');
const pidFile = join(stackDir, 'nginx.pid');
const readDotEnv = () => {
    const path = join(repoRoot, '.env');
    if (!existsSync(path))
        return {};
    const out = {};
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1)
            continue;
        out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
    return out;
};
const dotenv = readDotEnv();
const recordingsDir = process.env.RECORDING_LOCAL_DIR ??
    dotenv.RECORDING_LOCAL_DIR ??
    join(repoRoot, 'var', 'recordings');
const apiUpstreams = (process.env.STACK_API_UPSTREAMS ?? '127.0.0.1:8787 127.0.0.1:8788')
    .split(/\s+/)
    .filter(Boolean)
    .map((addr) => `    server ${addr} max_fails=3 fail_timeout=10s;`)
    .join('\n');
const sseUpstreams = (process.env.STACK_SSE_UPSTREAMS ?? '127.0.0.1:8789 127.0.0.1:8790')
    .split(/\s+/)
    .filter(Boolean)
    .map((addr) => `    server ${addr} max_fails=3 fail_timeout=10s;`)
    .join('\n');
const renderNginxConf = () => `worker_processes auto;
error_log ${join(stackDir, 'error.log')} warn;
pid ${pidFile};

events { worker_connections 2048; }

http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  access_log ${join(stackDir, 'access.log')};

  sendfile on;
  tcp_nopush on;
  keepalive_timeout 65;
  client_max_body_size 512m;

  upstream api {
${apiUpstreams}
    keepalive 64;
  }

  upstream sse_pool {
${sseUpstreams}
    keepalive 64;
  }

  server {
    listen 8080;
    server_name _;

    location /media/recordings/ {
      alias ${recordingsDir.endsWith('/') ? recordingsDir : `${recordingsDir}/`};
      add_header Cache-Control "public, max-age=60";
      add_header Access-Control-Allow-Origin "*";
      autoindex off;
    }

    location /api/events {
      proxy_pass http://sse_pool;
      proxy_http_version 1.1;
      proxy_set_header Connection '';
      proxy_buffering off;
      proxy_cache off;
      proxy_read_timeout 3600s;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/ai/ {
      proxy_pass http://api;
      proxy_http_version 1.1;
      proxy_set_header Connection '';
      proxy_buffering off;
      proxy_request_buffering off;
      proxy_cache off;
      proxy_read_timeout 3600s;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
      proxy_pass http://api;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_read_timeout 120s;
    }
  }
}
`;
const redisOk = () => spawnSync('redis-cli', ['ping'], { stdio: 'pipe' }).stdout?.toString().trim() === 'PONG';
const nginxRunning = () => {
    if (!existsSync(pidFile))
        return false;
    const pid = Number.parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    if (!Number.isFinite(pid))
        return false;
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
};
const startNginx = () => {
    mkdirSync(stackDir, { recursive: true });
    mkdirSync(recordingsDir, { recursive: true });
    writeFileSync(nginxConfPath, renderNginxConf(), 'utf8');
    if (nginxRunning()) {
        const reload = spawnSync('nginx', ['-s', 'reload', '-c', nginxConfPath, '-p', stackDir], {
            stdio: 'inherit',
        });
        if (reload.status !== 0)
            process.exit(reload.status ?? 1);
        console.log(`stack: reloaded nginx (${nginxConfPath})`);
        return;
    }
    const start = spawnSync('nginx', ['-c', nginxConfPath, '-p', stackDir], { stdio: 'inherit' });
    if (start.status !== 0) {
        console.error('stack: failed to start nginx — is it installed? (brew install nginx)');
        process.exit(start.status ?? 1);
    }
    console.log(`stack: nginx listening on :8080 (${nginxConfPath})`);
};
const stopNginx = () => {
    if (!nginxRunning()) {
        console.log('stack: nginx is not running');
        return;
    }
    const stop = spawnSync('nginx', ['-s', 'quit', '-c', nginxConfPath, '-p', stackDir], {
        stdio: 'inherit',
    });
    if (stop.status !== 0)
        process.exit(stop.status ?? 1);
    if (existsSync(pidFile))
        unlinkSync(pidFile);
    console.log('stack: nginx stopped');
};
const status = () => {
    console.log('stack status');
    console.log(`  redis: ${redisOk() ? 'up' : 'down (start redis-server)'}`);
    console.log(`  nginx: ${nginxRunning() ? `up (pid ${readFileSync(pidFile, 'utf8').trim()})` : 'down'}`);
    console.log(`  recordings: ${recordingsDir}`);
    console.log('  api upstreams:');
    for (const line of apiUpstreams.split('\n'))
        console.log(`   ${line.trim()}`);
    console.log('  sse upstreams:');
    for (const line of sseUpstreams.split('\n'))
        console.log(`   ${line.trim()}`);
    if (existsSync(nginxConfPath))
        console.log(`  config: ${nginxConfPath}`);
};
const up = () => {
    if (!redisOk()) {
        console.warn('stack: WARNING redis is not reachable at redis-cli default — start Redis before the API');
    }
    startNginx();
    status();
    console.log('\nStart processes locally, for example:');
    console.log('  PORT=8787 npm run start --workspace @shop/api');
    console.log('  PORT=8788 npm run start --workspace @shop/api');
    console.log('  PORT=8789 npm run start --workspace @shop/sse-gateway');
    console.log('  PORT=8790 npm run start --workspace @shop/sse-gateway');
    console.log('  npm run start:background --workspace @shop/api');
};
const command = process.argv[2] ?? 'up';
switch (command) {
    case 'up':
        up();
        break;
    case 'down':
        stopNginx();
        break;
    case 'status':
        status();
        break;
    default:
        console.error(`unknown command: ${command} (expected up | down | status)`);
        process.exit(1);
}
