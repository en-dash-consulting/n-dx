/**
 * Assistant-integration cross-vendor contract test.
 *
 * Validates the cross-package boundary between core's orchestration layer
 * (`assistant-integration.js`) and the vendor-specific integration modules
 * (`claude-integration.js`, `codex-integration.js`).
 *
 * The test exercises `setupAssistantIntegrations()` in a temporary directory
 * to verify:
 *   1. Both vendors produce results with the expected shape.
 *   2. `formatInitReport()` returns well-formed summary lines.
 *   3. Disabling a vendor via the `enabled` map produces a skipped result
 *      without affecting the other vendor.
 *
 * @see packages/core/assistant-integration.js
 * @see packages/core/claude-integration.js
 * @see packages/core/codex-integration.js
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Force claude CLI discovery to fail so `setupClaudeIntegration` skips the
// real `claude mcp add`/`claude mcp remove` calls (5–30s each). This test
// only verifies the cross-vendor result shape and formatInitReport output —
// both emit regardless of MCP registration outcome. See
// packages/core/claude-integration.js:306–320.
process.env.CLAUDE_CLI_PATH = "/nonexistent/path/to/claude";

// Import from the core orchestration module (plain JS — no build step)
const { setupAssistantIntegrations, formatInitReport } = await import(
  "../../packages/core/assistant-integration.js"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a disposable temp directory for a single test. */
function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "assistant-integration-test-"));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("assistant-integration cross-vendor contract", { timeout: 30_000 }, () => {
  /** @type {string[]} */
  const tmpDirs = [];

  afterEach(() => {
    for (const d of tmpDirs) {
      rmSync(d, { recursive: true, force: true });
    }
    tmpDirs.length = 0;
  });

  // ── setupAssistantIntegrations — both vendors enabled ───────────────────

  it("returns results for both claude and codex with expected shape", () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);

    const results = setupAssistantIntegrations(dir);

    // Both vendor keys must be present
    expect(results).toHaveProperty("claude");
    expect(results).toHaveProperty("codex");

    for (const vendor of ["claude", "codex"]) {
      const entry = results[vendor];

      // Required shape: summary (string), label (string), skipped (boolean)
      expect(typeof entry.summary).toBe("string");
      expect(entry.summary.length).toBeGreaterThan(0);

      expect(typeof entry.label).toBe("string");
      expect(entry.label.length).toBeGreaterThan(0);

      expect(typeof entry.skipped).toBe("boolean");
      expect(entry.skipped).toBe(false);

      // detail must be a non-null object (vendor-specific detail payload)
      expect(entry.detail).toBeDefined();
      expect(typeof entry.detail).toBe("object");
      expect(entry.detail).not.toBeNull();
    }
  });

  // ── formatInitReport ────────────────────────────────────────────────────

  it("formatInitReport returns lines starting with 'Assistant surfaces:'", () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);

    const results = setupAssistantIntegrations(dir);
    const lines = formatInitReport(results);

    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toMatch(/Assistant surfaces:/);

    // Each entry should be a string
    for (const line of lines) {
      expect(typeof line).toBe("string");
    }
  });

  // ── Disabling a vendor ──────────────────────────────────────────────────

  it("disabling claude skips it but still provisions codex", () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);

    const results = setupAssistantIntegrations(dir, { claude: false });

    // Claude should be skipped
    expect(results.claude.skipped).toBe(true);
    expect(results.claude.summary).toMatch(/skipped/i);

    // Codex should still be fully provisioned
    expect(results.codex.skipped).toBe(false);
    expect(results.codex.detail).toBeDefined();
    expect(typeof results.codex.detail).toBe("object");
  });

  it("disabling codex skips it but still provisions claude", () => {
    const dir = makeTmpDir();
    tmpDirs.push(dir);

    const results = setupAssistantIntegrations(dir, { codex: false });

    // Codex should be skipped
    expect(results.codex.skipped).toBe(true);
    expect(results.codex.summary).toMatch(/skipped/i);

    // Claude should still be fully provisioned
    expect(results.claude.skipped).toBe(false);
    expect(results.claude.detail).toBeDefined();
    expect(typeof results.claude.detail).toBe("object");
  });
});
