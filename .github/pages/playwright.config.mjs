import { defineConfig } from '@playwright/test';

// 외부 서비스·운영 계정 없이 로컬 Chromium으로 회귀 검사
export default defineConfig({
  testDir: '.', testMatch: 'browser.spec.mjs', workers: 1,
  outputDir: '../../build/browser-results',
  use: { baseURL: 'http://127.0.0.1:4173', headless: true,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] } },
  webServer: { command: 'node .github/pages/browser-server.mjs', cwd: '../..', port: 4173, timeout: 120000 },
});
