import { defineConfig } from "@playwright/test";

/**
 * Manual browser suite — real-vendor dashboard flows, recorded on video.
 *
 * Unlike `playwright.config.ts` (the LLM-free `e2e-ui` suite), every spec
 * here drives the dashboard against the operator's real Claude CLI login
 * (and Codex when installed): it spends tokens, takes minutes per task and
 * is non-deterministic by design. It is never run by `pnpm test` or CI.
 *
 *   pnpm run test:e2e-manual                # all three flows
 *   pnpm run test:e2e-manual -- --grep prompt
 *   pnpm run test:e2e-manual:report         # open the HTML report
 *
 * Videos land in test-results/manual/<test>/video.webm; the HTML report
 * (playwright-report/manual) links each video, trace and the attached
 * hench run records. Both directories are gitignored.
 *
 * Prerequisites: `pnpm run build` here, `npx playwright install chromium`,
 * `claude` on PATH and logged in. Run from a plain terminal rather than
 * inside a Claude Code session — see TESTING.md § Manual browser suite.
 */
const MANUAL_TIMEOUT_MS = Number(process.env["NDX_E2E_MANUAL_TIMEOUT_MS"] ?? 45 * 60_000);

export default defineConfig({
  testDir: "./tests/e2e-ui-manual",
  testMatch: /.*\.spec\.ts/,
  timeout: MANUAL_TIMEOUT_MS,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: "test-results/manual",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report/manual" }],
  ],
  use: {
    // A missing control must fail in seconds, not eat the whole test budget;
    // the long waits (agent runs, analyses) pass their own expect timeouts.
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    viewport: { width: 1280, height: 720 },
    video: { mode: "on", size: { width: 1280, height: 720 } },
    trace: "on",
    screenshot: "only-on-failure",
  },
});
