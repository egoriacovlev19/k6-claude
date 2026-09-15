import { defineConfig } from '@playwright/test';
import path from 'node:path';

// The CLI resolves project settings once and passes an immutable snapshot to workers.
const config = JSON.parse(process.env.QA_CONFIG || '{}');
const run = process.env.QA_RUN_DIR || 'artifacts/manual';
export default defineConfig({
  testDir: `./projects/${process.env.QA_PROJECT}/tests/${process.env.QA_SUITE || 'ui'}`,
  fullyParallel: true, workers: Number(process.env.QA_WORKERS || 1), retries: 0,
  timeout: config.timeoutMs || 30000,
  outputDir: path.join(run, `playwright-${process.env.QA_ITERATION || 0}`),
  reporter: [['list'], ['allure-playwright', { resultsDir: path.join(run, 'allure-results') }], ['./core/playwright/reporter.ts']],
  use: {
    baseURL: process.env.QA_BASE_URL,
    // K6_PERFORMANCE_HEADED=true — открыть видимый браузер, чтобы глазами смотреть на тест при отладке.
    headless: process.env.K6_PERFORMANCE_HEADED !== 'true',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
