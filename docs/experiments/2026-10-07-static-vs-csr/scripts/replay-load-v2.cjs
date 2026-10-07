const { request } = require('/home/ubuntu/Develop/project/ken-blog/node_modules/playwright');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');

const implementation = process.argv[2];
if (!['csr', 'hybrid'].includes(implementation)) throw new Error('usage: node replay-load-v2.cjs csr|hybrid');
const origin = `https://${implementation}.127.0.0.1.nip.io:18444`;
const all = fs.readFileSync('results-v2/perf-runs.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const row = all.find(x => !x.discarded && x.scenario === 'erd_document' && x.implementation === implementation && x.profile === 'R' && x.cache === 'cold' && x.iteration === 1);
if (!row) throw new Error(`missing measured cold ERD row for ${implementation}`);
const requests = row.requests.filter(x => x.api).sort((a, b) => a.start_ms - b.start_ms);
if (!requests.length) throw new Error(`no API requests recorded for ${implementation}`);
const csrfRecord = requests.find(x => x.method === 'GET' && x.path.split('?')[0] === '/api/v1/auth/csrf');
if (requests.some(x => x.method !== 'GET' && !(x.method === 'POST' && /^\/api\/v1\/posts\/\d+\/view$/.test(x.path.split('?')[0])))) {
  throw new Error(`unexpected write method in recorded request list for ${implementation}`);
}
const safeRequests = requests.map(({ method, path, start_ms, response_ms, status, server_api, resource_type }) =>
  ({ method, path, start_ms, response_ms, status, server_api, resource_type }));
fs.writeFileSync(`results-v2/load-request-list-${implementation}.json`, JSON.stringify({
  source_scenario: row.scenario,
  source_profile: row.profile,
  source_cache: row.cache,
  source_iteration: row.iteration,
  requests: safeRequests,
}, null, 2) + '\n');

const waitUntil = async target => {
  const remaining = target - performance.now();
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
};
const totals = { opened: 0, requests_sent: 0, failed: 0, status_counts: {}, request_errors: 0 };
const failures = [];

async function dispatch(context, rec, scheduled, csrfPromise) {
  await waitUntil(scheduled);
  const pathname = rec.path.split('?')[0];
  let headers = { Accept: 'application/json' };
  if (rec.method === 'POST') {
    const csrf = await csrfPromise;
    if (!csrf || csrf.headerName !== 'X-CSRF-TOKEN' || typeof csrf.token !== 'string' || !csrf.token) {
      totals.failed++;
      failures.push({ path: pathname, error: 'CSRF token unavailable' });
      return null;
    }
    headers = { ...headers, [csrf.headerName]: csrf.token };
  }
  totals.requests_sent++;
  try {
    const response = await context.fetch(new URL(rec.path, origin).toString(), {
      method: rec.method,
      headers,
      timeout: 30000,
    });
    const status = response.status();
    let csrf = null;
    if (pathname === '/api/v1/auth/csrf') csrf = await response.json().catch(() => null);
    await response.body();
    await response.dispose();
    totals.status_counts[status] = (totals.status_counts[status] || 0) + 1;
    if (pathname === '/api/v1/auth/csrf') {
      return csrf;
    }
    if (status >= 400 && !(pathname === '/api/v1/auth/me' && status === 401)) {
      totals.failed++;
      failures.push({ path: pathname, status });
    }
    return null;
  } catch (error) {
    totals.failed++;
    totals.request_errors++;
    failures.push({ path: pathname, error: String(error.message || error).slice(0, 120) });
    return null;
  }
}

async function runReader(startAt, index) {
  const context = await request.newContext({ ignoreHTTPSErrors: true });
  const csrfRec = csrfRecord;
  const csrfTask = csrfRec ? dispatch(context, csrfRec, startAt + csrfRec.start_ms, Promise.resolve(null)) : null;
  const tasks = requests.filter(x => x !== csrfRec).map(rec => dispatch(context, rec, startAt + rec.start_ms, csrfTask || Promise.reject(new Error('CSRF request was absent'))));
  const csrf = csrfTask ? await csrfTask : null;
  if (csrfTask && (!csrf || csrf.headerName !== 'X-CSRF-TOKEN' || typeof csrf.token !== 'string' || !csrf.token)) {
    totals.failed++;
    failures.push({ reader: index, path: '/api/v1/auth/csrf', error: 'invalid CSRF response shape' });
  }
  await Promise.all(tasks);
  totals.opened++;
  await context.dispose();
}

(async () => {
  const count = 300;
  const intervalMs = 200;
  const firstStart = performance.now() + 1000;
  const firstStartUtc = new Date(Date.now() + 1000).toISOString();
  const lastStartUtc = new Date(Date.parse(firstStartUtc) + (count - 1) * intervalMs).toISOString();
  const tasks = [];
  for (let i = 0; i < count; i++) {
    const startAt = firstStart + i * intervalMs;
    await waitUntil(startAt);
    tasks.push(runReader(startAt, i + 1));
    if (i % 25 === 0) console.log(`${implementation} readers started ${i + 1}/${count}`);
  }
  await Promise.all(tasks);
  const finishUtc = new Date().toISOString();
  const result = {
    implementation,
    source_scenario: row.scenario,
    readers: count,
    interval_ms: intervalMs,
    scheduled_opening_window_seconds: 60,
    first_reader_utc: firstStartUtc,
    last_reader_utc: lastStartUtc,
    finished_utc: finishUtc,
    api_request_list: safeRequests,
    ...totals,
    failures: failures.slice(0, 100),
  };
  fs.appendFileSync('results-v2/load-replay-results.jsonl', JSON.stringify(result) + '\n');
  console.log(JSON.stringify({ implementation, readers: totals.opened, requests_sent: totals.requests_sent, failed: totals.failed, status_counts: totals.status_counts, first_reader_utc: firstStartUtc, finished_utc: finishUtc }));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
