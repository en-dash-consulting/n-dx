/**
 * Web server ↔ viewer boundary integration test.
 *
 * Validates that the web package's internal zone boundaries are maintained:
 *   - Server-side gateways (rex-gateway.ts, domain-gateway.ts) re-export
 *     correct symbols from upstream packages
 *   - Shared types are importable from the built dist/ artifacts
 *   - The register-scheduler facade exports match the documented interface
 *
 * This test imports from built dist/ artifacts (not source .ts files)
 * to catch contract breaks at the compiled boundary.
 *
 * @see packages/web/src/server/rex-gateway.ts
 * @see packages/web/src/server/domain-gateway.ts
 * @see packages/web/src/server/shared-types.ts
 * @see packages/web/src/server/register-scheduler.ts
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// web server shared types contract
// ---------------------------------------------------------------------------

describe("web server shared types boundary", () => {
  it("shared-types exports are importable from dist", async () => {
    // shared-types is a type-only module — it should compile to an empty
    // JS module but the types should still be importable for runtime checks
    const mod = await import(
      "../../packages/web/dist/server/shared-types.js"
    );

    // Module should load without error
    expect(mod).toBeDefined();
  });

  it("register-scheduler exports the facade function", async () => {
    const mod = await import(
      "../../packages/web/dist/server/register-scheduler.js"
    );

    expect(typeof mod.registerUsageScheduler).toBe("function");
  });

  it("usage-cleanup-scheduler exports core functions", async () => {
    const mod = await import(
      "../../packages/web/dist/server/usage-cleanup-scheduler.js"
    );

    expect(typeof mod.startUsageCleanupScheduler).toBe("function");
    expect(typeof mod.runCleanupCycle).toBe("function");
    expect(typeof mod.identifyOrphanedEntries).toBe("function");
    expect(typeof mod.loadCleanupConfig).toBe("function");
    expect(typeof mod.DEFAULT_CLEANUP_INTERVAL_MS).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// web → rex gateway contract
// ---------------------------------------------------------------------------

describe("web → rex gateway contract", () => {
  it("web rex-gateway re-exports createRexMcpServer", async () => {
    const gw = await import(
      "../../packages/web/dist/server/rex-gateway.js"
    );

    expect(typeof gw.createRexMcpServer).toBe("function");
  });

  it("web domain-gateway re-exports sourcevision MCP factory", async () => {
    const gw = await import(
      "../../packages/web/dist/server/domain-gateway.js"
    );

    expect(typeof gw.createSourcevisionMcpServer).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// cleanup scheduler data flow types
// ---------------------------------------------------------------------------

describe("cleanup data flow type compatibility", () => {
  it("identifyOrphanedEntries produces OrphanedEntry-compatible objects", async () => {
    const { identifyOrphanedEntries } = await import(
      "../../packages/web/dist/server/usage-cleanup-scheduler.js"
    );

    const taskUsage = {
      "valid-task": { totalTokens: 100, runCount: 1 },
      "orphan-task": { totalTokens: 500, runCount: 3 },
    };
    const validIds = new Set(["valid-task"]);

    const orphaned = identifyOrphanedEntries(taskUsage, validIds);

    expect(orphaned.length).toBe(1);
    expect(orphaned[0].taskId).toBe("orphan-task");
    expect(orphaned[0].totalTokens).toBe(500);
    expect(orphaned[0].runCount).toBe(3);
  });

  it("DEFAULT_CLEANUP_INTERVAL_MS is 7 days in milliseconds", async () => {
    const { DEFAULT_CLEANUP_INTERVAL_MS } = await import(
      "../../packages/web/dist/server/usage-cleanup-scheduler.js"
    );

    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    expect(DEFAULT_CLEANUP_INTERVAL_MS).toBe(SEVEN_DAYS_MS);
  });
});
