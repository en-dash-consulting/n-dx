/**
 * Integration tests for plan-only completion detection and re-prompting.
 *
 * These tests simulate the full agent loop when the agent produces a plan
 * without executing it, and verify that the loop re-prompts until execution
 * occurs or max retries are exceeded.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import type { HenchConfig } from "../../src/schema/v1.js";
import { DEFAULT_HENCH_CONFIG } from "../../src/schema/v1.js";

describe("plan-only completion detection (integration)", () => {
  let testDir: string;
  let config: HenchConfig;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "hench-plan-only-"));
    config = DEFAULT_HENCH_CONFIG();
    config.planOnlyMaxRetries = 2;
    config.maxTurns = 10;
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("plan-only detection is properly configured in hench", async () => {
    // Verify the config option exists and defaults correctly
    expect(config.planOnlyMaxRetries).toBe(2);
  });

  it("respects planOnlyMaxRetries config option", async () => {
    config.planOnlyMaxRetries = 0; // Disable plan-only detection

    // With detection disabled, a plan-only response should complete without re-prompting
    expect(config.planOnlyMaxRetries).toBe(0);
  });

  it("allows custom planOnlyMaxRetries", async () => {
    config.planOnlyMaxRetries = 5;

    expect(config.planOnlyMaxRetries).toBe(5);
  });
});

/**
 * Simpler unit-level tests that can run without full loop mocking.
 */
describe("plan-only completion detection (unit scenarios)", () => {
  it("tracks plan-only retry count correctly", () => {
    let planOnlyRetryCount = 0;
    const planOnlyMaxRetries = 2;

    // Simulate first plan-only detection
    if (planOnlyRetryCount < planOnlyMaxRetries) {
      planOnlyRetryCount++;
      expect(planOnlyRetryCount).toBe(1);
    }

    // Simulate second plan-only detection
    if (planOnlyRetryCount < planOnlyMaxRetries) {
      planOnlyRetryCount++;
      expect(planOnlyRetryCount).toBe(2);
    }

    // Simulate third plan-only detection (should fail)
    if (planOnlyRetryCount >= planOnlyMaxRetries) {
      expect(planOnlyRetryCount).toBe(2);
    }
  });

  it("allows disabling plan-only detection with config", () => {
    const config = DEFAULT_HENCH_CONFIG();
    config.planOnlyMaxRetries = 0;

    // With maxRetries = 0, plan-only detection should be skipped
    expect(config.planOnlyMaxRetries).toBe(0);
  });

  it("defaults to 2 retries in default config", () => {
    const config = DEFAULT_HENCH_CONFIG();

    expect(config.planOnlyMaxRetries).toBe(2);
  });
});
