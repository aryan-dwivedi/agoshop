#!/usr/bin/env node
/**
 * `npm run loadtest` — runs `loadtest/reset.ts` before EACH scenario, then all six k6
 * scripts in order, and writes `loadtest/results/summary.json`.
 *
 * Resetting between scenarios is what makes the suite repeatable rather than only
 * correct on a cold database: L2 needs the load session's one-way delivery tier back at
 * `rtc`, L5 needs stock back at exactly 100, and L3 needs an empty analytics stream.
 *
 * Prerequisites (checked, and reported rather than assumed):
 *   - the two-replica stack is up behind nginx        (npm run stack:up, or infra/docker-compose.yml)
 *   - npm run db:seed and npm run loadtest:seed have run
 *   - k6 is installed                                 (brew install k6)
 *   - the load env: RTC_TIER_MAX_VIEWERS=150 so the tier transition happens mid-run
 *     instead of on the first join, and RTM_CHAT_SHARD_TARGET=2 which, with the load
 *     session's expectedPeakViewers:300, clamps to 49 chat shards.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const loadRoot = join(repoRoot, 'loadtest');
const resultsDir = join(loadRoot, 'results');
const generatedDir = join(loadRoot, '.generated');

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8080';
const RUN_ID = `run-${Date.now()}`;

/** The load profile the plan pins. Mismatches are reported, not silently tolerated. */
const REQUIRED_ENV = { RTC_TIER_MAX_VIEWERS: '150', RTM_CHAT_SHARD_TARGET: '2' };

// Scripts are addressed from the repo root, because each one's `handleSummary` writes
// `loadtest/results/<name>.json` relative to k6's working directory. `open()` inside a
// script resolves against the SCRIPT file, so the fixture reads are unaffected.
const SCENARIOS = [
  { id: 'L1', name: 'browse', script: 'loadtest/k6/browse.js' },
  { id: 'L2', name: 'live-join', script: 'loadtest/k6/live-join.js' },
  { id: 'L3', name: 'engagement', script: 'loadtest/k6/engagement.js' },
  { id: 'L4', name: 'checkout-burst', script: 'loadtest/k6/checkout-burst.js' },
  { id: 'L5', name: 'oversell', script: 'loadtest/k6/oversell.js' },
  { id: 'L6', name: 'ai-proxy', script: 'loadtest/k6/ai-proxy.js' },
  { id: 'L7', name: 'mcp-proxy', script: 'loadtest/k6/mcp-proxy.js' },
];

const readDotEnv = () => {
  const path = join(repoRoot, '.env');
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) out[match[1]] = match[2];
  }
  return out;
};

const dotenv = readDotEnv();

const preflight = () => {
  const problems = [];

  if (spawnSync('k6', ['version'], { stdio: 'ignore' }).status !== 0) {
    problems.push('k6 is not installed (brew install k6)');
  }
  if (
    !existsSync(join(generatedDir, 'sessions.json')) ||
    !existsSync(join(generatedDir, 'conversations.json'))
  ) {
    problems.push('loadtest/.generated is missing — run: npm run loadtest:seed');
  }
  if (problems.length > 0) {
    console.error(`loadtest: cannot start\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }

  for (const [key, expected] of Object.entries(REQUIRED_ENV)) {
    const actual = process.env[key] ?? dotenv[key];
    if (actual !== expected) {
      console.warn(
        `loadtest: WARNING ${key}=${actual ?? '(unset)'} but the load profile expects ${expected}. ` +
          `Set it in .env and restart the API replicas, or L2's tier transition and the 49-shard ` +
          `clamp will not be exercised as documented.`,
      );
    }
  }
};

const waitForApi = () => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const probe = spawnSync('curl', ['-fsS', '-m', '3', `${API_BASE}/api/health`], {
      encoding: 'utf8',
    });
    if (probe.status === 0) {
      console.log(`loadtest: API healthy at ${API_BASE} -> ${probe.stdout.trim()}`);
      return;
    }
    spawnSync('sleep', ['1']);
  }
  console.error(`loadtest: ${API_BASE}/api/health never became healthy — is the stack up?`);
  process.exit(1);
};

const runReset = () => {
  const result = spawnSync(
    process.execPath,
    ['--env-file=.env', '--import', 'tsx', 'loadtest/reset.ts'],
    { cwd: repoRoot, stdio: 'inherit' },
  );
  if (result.status !== 0) {
    console.error('loadtest: reset failed; aborting so the results are not misleading');
    process.exit(1);
  }
};

const runScenario = (scenario) => {
  console.log(`\n=== ${scenario.id} ${scenario.name} ===`);
  runReset();
  const started = Date.now();
  const result = spawnSync('k6', ['run', scenario.script], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      API_BASE,
      RUN_ID,
      CONVO_LLM_SHARED_SECRET:
        process.env.CONVO_LLM_SHARED_SECRET ?? dotenv.CONVO_LLM_SHARED_SECRET ?? '',
    },
  });

  // k6 exits non-zero when a threshold is breached; that is a RESULT, not a crash, so the
  // suite continues and the summary records it.
  const thresholdsPassed = result.status === 0;
  const resultPath = join(resultsDir, `${scenario.name}.json`);
  let metrics = null;
  if (existsSync(resultPath)) {
    try {
      const raw = JSON.parse(readFileSync(resultPath, 'utf8'));
      metrics = summarize(raw);
    } catch (err) {
      console.error(`loadtest: could not parse ${resultPath}: ${err.message}`);
    }
  }

  return {
    id: scenario.id,
    name: scenario.name,
    script: scenario.script,
    thresholdsPassed,
    exitCode: result.status,
    durationSeconds: Math.round((Date.now() - started) / 1000),
    metrics,
  };
};

const summarize = (raw) => {
  const m = raw.metrics ?? {};
  const pick = (key, field) => (m[key] && m[key].values ? m[key].values[field] : null);
  const breached = Object.entries(m)
    .filter(
      ([, value]) =>
        value.thresholds && Object.values(value.thresholds).some((t) => t.ok === false),
    )
    .map(([key]) => key);

  return {
    httpReqs: pick('http_reqs', 'count'),
    rps: pick('http_reqs', 'rate'),
    p95Ms: pick('http_req_duration', 'p(95)'),
    p99Ms: pick('http_req_duration', 'p(99)'),
    ttfbP95Ms: pick('http_req_waiting', 'p(95)'),
    failedRate: pick('http_req_failed', 'rate'),
    checksRate: pick('checks', 'rate'),
    custom: Object.fromEntries(
      Object.entries(m)
        .filter(
          ([key]) =>
            !key.startsWith('http_') &&
            ![
              'checks',
              'iterations',
              'vus',
              'vus_max',
              'data_sent',
              'data_received',
              'iteration_duration',
              'group_duration',
            ].includes(key),
        )
        .map(([key, value]) => [key, value.values]),
    ),
    breachedThresholds: breached,
  };
};

preflight();
mkdirSync(resultsDir, { recursive: true });
waitForApi();

const scenarios = SCENARIOS.map(runScenario);

const summary = {
  runId: RUN_ID,
  startedAt: new Date().toISOString(),
  apiBase: API_BASE,
  hardware: {
    platform: process.platform,
    arch: process.arch,
    cpus: (await import('node:os')).cpus().length,
    totalMemoryGb: Math.round((await import('node:os')).totalmem() / 1024 ** 3),
  },
  replicas: 2,
  loadProfile: REQUIRED_ENV,
  observedEnv: Object.fromEntries(
    Object.keys(REQUIRED_ENV).map((key) => [key, process.env[key] ?? dotenv[key] ?? null]),
  ),
  scenarios,
  allThresholdsPassed: scenarios.every((s) => s.thresholdsPassed),
};

writeFileSync(join(resultsDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

console.log('\n=== loadtest summary ===');
for (const scenario of scenarios) {
  const p95 =
    scenario.metrics && scenario.metrics.p95Ms !== null
      ? `${Math.round(scenario.metrics.p95Ms)}ms`
      : 'n/a';
  console.log(
    `${scenario.id} ${scenario.name.padEnd(15)} ${scenario.thresholdsPassed ? 'PASS' : 'FAIL'}  p95=${p95}` +
      (scenario.metrics && scenario.metrics.breachedThresholds.length > 0
        ? `  breached: ${scenario.metrics.breachedThresholds.join(', ')}`
        : ''),
  );
}
console.log(`\nwritten: loadtest/results/summary.json`);
process.exit(summary.allThresholdsPassed ? 0 : 1);
