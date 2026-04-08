/**
 * Vendor/model header E2E tests.
 *
 * Verifies that ndx commands which invoke an LLM print a single header line
 * at command start showing the active vendor and resolved model:
 *
 *   Vendor: claude  Model: claude-sonnet-4-6 (default)
 *
 * Acceptance criteria:
 * - Header is present in CLI stdout for at least one command in each package
 *   (rex, sourcevision, hench).
 * - Header is suppressed in --quiet mode.
 * - Header is suppressed in --format=json mode.
 *
 * @see packages/llm-client/src/vendor-header.ts — implementation
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTmpDir,
  removeTmpDir,
  runResult,
  setupRexDir,
  setupHenchDir,
  setupSourcevisionDir,
} from "./e2e-helpers.js";

describe("vendor/model header in CLI output", { timeout: 30_000 }, () => {
  let tmpDir;

  beforeAll(async () => {
    tmpDir = await createTmpDir("ndx-vendor-header-");
    await setupRexDir(tmpDir);
    await setupHenchDir(tmpDir);
    await setupSourcevisionDir(tmpDir);
  });

  afterAll(async () => {
    await removeTmpDir(tmpDir);
  });

  // ── rex package ─────────────────────────────────────────────────────────────

  it("rex analyze: prints vendor/model header", () => {
    // rex analyze falls back gracefully when LLM is unavailable (no API key).
    // The header is printed in initLLMClients before any LLM call is attempted,
    // so it appears in stdout regardless of whether LLM succeeds.
    const result = runResult(["rex", "analyze", tmpDir]);
    expect(result.stdout).toContain("Vendor: claude");
    expect(result.stdout).toContain("Model:");
  });

  it("rex analyze: header shows model source (configured | default)", () => {
    // Without .n-dx.json, the default model is used — source should be "default".
    const result = runResult(["rex", "analyze", tmpDir]);
    expect(result.stdout).toMatch(/Model:.*\((configured|default)\)/);
  });

  it("rex analyze: header is suppressed with --format=json", () => {
    const result = runResult(["rex", "analyze", "--format=json", tmpDir]);
    // --format=json suppresses the header; stdout contains only JSON
    expect(result.stdout).not.toContain("Vendor: claude  Model:");
  });

  // ── sourcevision package ─────────────────────────────────────────────────────

  it("sourcevision analyze: prints vendor/model header", () => {
    // --phase=1 runs only the inventory phase (no LLM needed), ensuring a clean
    // exit. The header is printed in initAndLoadLLMConfig before any phase runs.
    const result = runResult(["sourcevision", "analyze", "--phase=1", tmpDir]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Vendor: claude");
    expect(result.stdout).toContain("Model:");
  });

  // ── hench package ────────────────────────────────────────────────────────────

  it("hench run --dry-run: prints vendor/model header", () => {
    // --dry-run skips actual LLM execution and exits cleanly.
    // The header is printed at the very start of cmdRun before any LLM work.
    const result = runResult(["hench", "run", "--dry-run", tmpDir]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Vendor: claude");
    expect(result.stdout).toContain("Model:");
  });

  it("hench run --dry-run: header is suppressed with --quiet", () => {
    const result = runResult(["hench", "run", "--dry-run", "--quiet", tmpDir]);
    expect(result.code).toBe(0);
    // In quiet mode, info() is suppressed, so no vendor/model header
    expect(result.stdout).not.toContain("Vendor: claude  Model:");
  });
});
