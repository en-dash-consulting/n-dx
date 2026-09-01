import { defineConfig } from "@playwright/test";

/**
 * Browser-driven UI test suite — drives the real dashboard (dist build)
 * with headless Chromium through PRD, Hench Runs, and setup-wizard
 * workflows. Separate from the vitest unit/integration suite (`pnpm test`)
 * since it needs a real browser and a built `dist/`.
 *
 * Run with: pnpm run test:e2e-ui  (after `pnpm run build`)
 * Install the browser once with: npx playwright install chromium
 */
export default defineConfig({
  testDir: "./tests/e2e-ui",
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: 0,
  workers: process.env["CI"] ? 2 : undefined,
  reporter: [["list"]],
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
