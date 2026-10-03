import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fixture } from './fixture.mjs';

// 가상 사이트를 생성하고 로컬 전용 HTTP로 제공
await mkdir('build/fixture-content', { recursive: true });
await writeFile('build/frontend-fixture.json', JSON.stringify(fixture));
execFileSync(process.execPath, ['.github/pages/build.mjs', '--fixture=build/frontend-fixture.json', '--content-dir=build/fixture-content'], {
  stdio: 'inherit', env: { ...process.env, PUBLIC_API_BASE_URL: 'http://127.0.0.1:4173' },
});
const root = resolve('build/site');
createServer(async (request, response) => {
  // 정적 산출물 밖의 파일은 제공하지 않음
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = resolve(root, path.replace(/^\/ken-blog\//, '') + (path.endsWith('/') ? 'index.html' : ''));
  if (!path.startsWith('/ken-blog/') || !file.startsWith(root + '/')) { response.writeHead(404).end(); return; }
  try {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
    response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
}).listen(4173, '127.0.0.1');
