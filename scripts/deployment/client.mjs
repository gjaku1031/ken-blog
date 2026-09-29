/** GitHub Actions에서 단일 배포 operation을 claim/complete하며 비밀값을 출력하지 않음. */
import { appendFileSync, writeFileSync } from 'node:fs';

const command = process.argv[2];
const configuredBase = process.env.BLOG_API_BASE_URL;
let base;
try {
  const url = new URL(configuredBase);
  if (url.protocol === 'https:' && url.username === '' && url.password === '' &&
      url.pathname === '/' && url.search === '' && url.hash === '' &&
      (configuredBase === url.origin || configuredBase === url.origin + '/')) base = url.origin;
} catch {
  // 아래 공통 설정 검증에서 거부.
}
const token = process.env.BLOG_DEPLOY_TOKEN;
const runId = process.env.GITHUB_RUN_ID;
const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);
if (!base || !token || !/^[1-9][0-9]*$/.test(runId ?? '') || !Number.isSafeInteger(runAttempt) || runAttempt <= 0) {
  throw new Error('Deployment callback configuration is incomplete.');
}

/** 검증된 서버 상태 코드만 처리하고 본문과 인증값을 로그에 남기지 않음. */
async function post(path, payload) {
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error('Deployment callback delivery is uncertain.');
  }
  return response;
}

if (command === 'claim') {
  const operationId = process.env.DEPLOYMENT_ID?.trim() || undefined;
  const response = await post('/api/v1/deployments/claim', { operationId, runId, runAttempt });
  if (response.status === 409 && !operationId) {
    appendFileSync(process.env.GITHUB_OUTPUT, 'claimed=false\n');
    console.log('Another deployment owns the content gate; this run is skipped.');
  } else if (!response.ok) {
    throw new Error(`Deployment claim failed (${response.status}).`);
  } else {
    const state = await response.json();
    if (!/^[0-9a-f-]{36}$/.test(state.id ?? '') || state.runId !== runId || state.runAttempt !== runAttempt) {
      throw new Error('Deployment claim response is invalid.');
    }
    appendFileSync(process.env.GITHUB_OUTPUT, `claimed=true\ndeployment_id=${state.id}\n`);
    console.log(`Claimed deployment ${state.id}.`);
  }
} else if (command === 'complete') {
  const id = process.env.DEPLOYMENT_ID;
  const status = process.env.DEPLOYMENT_STATUS;
  if (!/^[0-9a-f-]{36}$/.test(id ?? '') || !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(status)) {
    throw new Error('Deployment completion input is invalid.');
  }
  const response = await post(`/api/v1/deployments/${id}/complete`, { runId, runAttempt, status });
  if (!response.ok) throw new Error(`Deployment completion failed (${response.status}); administrator recovery is required.`);
  const state = await response.json();
  console.log(state.status === 'RUNNING' ? `Deployment ${id} reported ${status}; terminal check is pending.` :
    `Deployment ${id} finalized as ${state.status}.`);
} else if (command === 'marker') {
  const id = process.env.DEPLOYMENT_ID;
  const sourceSha = process.env.GITHUB_SHA;
  if (!/^[0-9a-f-]{36}$/.test(id ?? '') || !/^[0-9a-f]{40}$/.test(sourceSha ?? '')) {
    throw new Error('Deployment marker input is invalid.');
  }
  writeFileSync('target/site/deployment.json', JSON.stringify({
    operationId: id, runId, runAttempt, sourceSha, generatedAt: new Date().toISOString(),
  }));
} else if (command === 'recover') {
  const targetRunId = process.env.TARGET_RUN_ID;
  const targetAttempt = Number(process.env.TARGET_RUN_ATTEMPT);
  if (!/^[1-9][0-9]*$/.test(targetRunId ?? '') || !Number.isSafeInteger(targetAttempt) || targetAttempt <= 0) {
    throw new Error('Recovery target is invalid.');
  }
  let response;
  for (let attempt = 0; attempt < 5; attempt++) {
    response = await post('/api/v1/deployments/recover', { runId: targetRunId, runAttempt: targetAttempt });
    if (response.status !== 503 || attempt === 4) break;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (response.status === 409) console.log('This completed run does not own the active content gate.');
  else if (!response.ok) throw new Error(`Deployment recovery failed (${response.status}); administrator recovery is required.`);
  else console.log(`Deployment run ${targetRunId} was checked after completion.`);
} else {
  throw new Error('Expected claim, marker, complete or recover command.');
}
