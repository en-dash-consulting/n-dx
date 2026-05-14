/**
 * Integration tests for LLM-driven sibling rename resolution.
 *
 * Covers:
 *   - detectNonDuplicateTitleCollisions: unit-level detection logic
 *   - runScopedConsolidationPass: full rename path with mocked LLM
 *   - Archive audit trail recording
 *   - Error propagation when LLM rename fails or produces a collision
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { cmdInit } from "../../src/cli/commands/init.js";
import { resolveStore } from "../../src/store/index.js";
import { REX_DIR } from "../../src/cli/commands/constants.js";
import { loadArchive, ARCHIVE_FILE } from "../../src/core/archive.js";
import type { PRDItem } from "../../src/schema/index.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

async function setupDir(): Promise<{ tmpDir: string; rexDir: string }> {
  const tmpDir = await mkdtemp(join(tmpdir(), "rex-sibling-rename-"));
  await cmdInit(tmpDir, {});
  return { tmpDir, rexDir: join(tmpDir, REX_DIR) };
}

async function cleanup(tmpDir: string): Promise<void> {
  try {
    await rm(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function makeFeature(overrides: Partial<PRDItem> & { title: string; description?: string }): PRDItem {
  return {
    id: randomUUID(),
    level: "feature",
    status: "pending",
    ...overrides,
  };
}

// ── Unit: detectNonDuplicateTitleCollisions ───────────────────────────────────

describe("detectNonDuplicateTitleCollisions", () => {
  let detectNonDuplicateTitleCollisions: (
    siblings: PRDItem[]
  ) => import("../../src/cli/commands/add-reshape.js").SiblingTitleCollisionPair[];

  beforeEach(async () => {
    ({ detectNonDuplicateTitleCollisions } = await import(
      "../../src/cli/commands/add-reshape.js"
    ));
  });

  it("returns empty for fewer than 2 siblings", () => {
    const result = detectNonDuplicateTitleCollisions([
      makeFeature({ title: "Auth Feature", description: "Implement login" }),
    ]);
    expect(result).toHaveLength(0);
  });

  it("detects a same-title pair with distinct descriptions as a collision", () => {
    const a = makeFeature({
      title: "Implement Authentication",
      description: "Add OAuth2 social login with Google and GitHub provider support",
    });
    const b = makeFeature({
      title: "Implement Authentication",
      description: "Build API token management with revocation and scopes for programmatic access",
    });

    const result = detectNonDuplicateTitleCollisions([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].normalizedTitle).toBe("implement authentication");
    expect(result[0].contentSimilarity).toBeLessThan(0.5);
  });

  it("does not flag a same-title pair with similar descriptions (true duplicate)", () => {
    const a = makeFeature({
      title: "Fix Auth Bug",
      description: "Fix the authentication token expiry bug causing logout on every request",
    });
    const b = makeFeature({
      title: "Fix Auth Bug",
      description: "Fix the authentication token expiry issue that logs users out unexpectedly",
    });

    const result = detectNonDuplicateTitleCollisions([a, b]);
    // High content similarity → true duplicate, not a non-duplicate collision
    expect(result).toHaveLength(0);
  });

  it("does not flag a same-title pair if either item has no description", () => {
    const a = makeFeature({ title: "Auth Feature" }); // no description
    const b = makeFeature({
      title: "Auth Feature",
      description: "Completely different auth concern with detailed spec",
    });

    const result = detectNonDuplicateTitleCollisions([a, b]);
    expect(result).toHaveLength(0);
  });

  it("does not flag pairs with different titles", () => {
    const a = makeFeature({
      title: "Auth Login",
      description: "Add OAuth2 social login",
    });
    const b = makeFeature({
      title: "Token Management",
      description: "API token scopes and revocation",
    });

    const result = detectNonDuplicateTitleCollisions([a, b]);
    expect(result).toHaveLength(0);
  });

  it("does not flag groups of 3+ same-title items (only pairwise supported)", () => {
    const items = [
      makeFeature({ title: "Implement Auth", description: "OAuth2 flow" }),
      makeFeature({ title: "Implement Auth", description: "API tokens and scopes" }),
      makeFeature({ title: "Implement Auth", description: "Two-factor authentication setup" }),
    ];

    const result = detectNonDuplicateTitleCollisions(items);
    expect(result).toHaveLength(0);
  });

  it("reports contentSimilarity for each detected pair", () => {
    const a = makeFeature({
      title: "Data Migration",
      description: "Migrate legacy SQL tables to the new normalized schema",
    });
    const b = makeFeature({
      title: "Data Migration",
      description: "Stream real-time events from Kafka to the analytics warehouse",
    });

    const result = detectNonDuplicateTitleCollisions([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].contentSimilarity).toBeGreaterThanOrEqual(0);
    expect(result[0].contentSimilarity).toBeLessThan(0.5);
  });
});

// ── Integration: runScopedConsolidationPass rename path ──────────────────────

describe("runScopedConsolidationPass — LLM rename path", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("../../src/analyze/rename-resolve.js", () => ({
      proposeSiblingRenames: vi.fn(),
    }));
    ({ tmpDir, rexDir } = await setupDir());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup(tmpDir);
  });

  it("renames two distinct same-title siblings via LLM and records in archive", async () => {
    const { runScopedConsolidationPass } = await import(
      "../../src/cli/commands/add-reshape.js"
    );
    const renameModule = await import("../../src/analyze/rename-resolve.js");
    const mockRename = vi.mocked(renameModule.proposeSiblingRenames);

    mockRename.mockResolvedValueOnce({
      titleA: "OAuth2 Social Login Integration",
      titleB: "API Token Management System",
      reasoning: "Item A covers social login via OAuth2; Item B covers programmatic API access via tokens",
    });

    const store = await resolveStore(rexDir);

    const epicId = randomUUID();
    const featureAId = randomUUID();
    const featureBId = randomUUID();

    await store.addItem({ id: epicId, title: "Authentication System", level: "epic", status: "pending" });

    await store.addItem({
      id: featureAId,
      title: "Implement Authentication",
      level: "feature",
      status: "pending",
      description: "Add OAuth2 social login with Google and GitHub as providers",
    }, epicId);

    await store.addItem({
      id: featureBId,
      title: "Implement Authentication",
      level: "feature",
      status: "pending",
      description: "Build API token management with scoped access and revocation for programmatic use",
    }, epicId);

    const result = await runScopedConsolidationPass(rexDir, store, featureBId, {});

    // Result should reflect rename
    expect(result.renamedCount).toBe(1);
    expect(result.mergedCount).toBe(0);
    expect(result.strategy).toBe("rename");
    expect(result.parentLabel).toBe("Authentication System");

    // Verify titles were updated in the store — order-agnostic because disk
    // read order may differ from insertion order
    const itemA = await store.getItem(featureAId);
    const itemB = await store.getItem(featureBId);
    const renamedTitles = new Set([itemA?.title, itemB?.title]);
    expect(renamedTitles).toContain("OAuth2 Social Login Integration");
    expect(renamedTitles).toContain("API Token Management System");
    // Both titles must be distinct (no collision)
    expect(renamedTitles.size).toBe(2);

    // Verify archive batch was written with rename audit trail
    const archive = await loadArchive(join(rexDir, ARCHIVE_FILE));
    const renameBatch = archive.batches.find((b) => b.source === "rename");
    expect(renameBatch).toBeDefined();
    expect(renameBatch?.renameAuditTrail).toHaveLength(1);

    const entry = renameBatch!.renameAuditTrail![0];
    // Both old titles must be the shared original
    expect(entry.oldTitleA).toBe("Implement Authentication");
    expect(entry.oldTitleB).toBe("Implement Authentication");
    // New titles must be the LLM-proposed values (order matches the group order)
    const newTitles = new Set([entry.newTitleA, entry.newTitleB]);
    expect(newTitles).toContain("OAuth2 Social Login Integration");
    expect(newTitles).toContain("API Token Management System");
    expect(entry.reasoning).toBeTruthy();

    // proposeSiblingRenames should have been called once
    expect(mockRename).toHaveBeenCalledOnce();
  });

  it("propagates error when LLM rename call fails (no fallback)", async () => {
    const { runScopedConsolidationPass } = await import(
      "../../src/cli/commands/add-reshape.js"
    );
    const renameModule = await import("../../src/analyze/rename-resolve.js");
    const mockRename = vi.mocked(renameModule.proposeSiblingRenames);

    mockRename.mockRejectedValueOnce(new Error("LLM unavailable"));

    const store = await resolveStore(rexDir);

    const epicId = randomUUID();
    const featureAId = randomUUID();
    const featureBId = randomUUID();

    await store.addItem({ id: epicId, title: "System", level: "epic", status: "pending" });
    await store.addItem({
      id: featureAId,
      title: "Data Processing",
      level: "feature",
      status: "pending",
      description: "ETL pipeline for transforming raw events into aggregated metrics",
    }, epicId);
    await store.addItem({
      id: featureBId,
      title: "Data Processing",
      level: "feature",
      status: "pending",
      description: "Real-time fraud detection using machine learning model inference",
    }, epicId);

    await expect(
      runScopedConsolidationPass(rexDir, store, featureBId, {}),
    ).rejects.toThrow("LLM unavailable");

    // Items should NOT have been renamed
    const itemA = await store.getItem(featureAId);
    const itemB = await store.getItem(featureBId);
    expect(itemA?.title).toBe("Data Processing");
    expect(itemB?.title).toBe("Data Processing");
  });

  it("fails clearly when LLM produces titles that collide with each other", async () => {
    const { runScopedConsolidationPass } = await import(
      "../../src/cli/commands/add-reshape.js"
    );
    const renameModule = await import("../../src/analyze/rename-resolve.js");
    const mockRename = vi.mocked(renameModule.proposeSiblingRenames);

    // proposeSiblingRenames itself validates the collision and throws
    mockRename.mockRejectedValueOnce(
      new Error("LLM rename produced a collision: both titles normalized to \"data feature\"."),
    );

    const store = await resolveStore(rexDir);

    const epicId = randomUUID();
    const featureAId = randomUUID();
    const featureBId = randomUUID();

    await store.addItem({ id: epicId, title: "System", level: "epic", status: "pending" });
    await store.addItem({
      id: featureAId,
      title: "Data Feature",
      level: "feature",
      status: "pending",
      description: "Process streaming events from the ingestion pipeline",
    }, epicId);
    await store.addItem({
      id: featureBId,
      title: "Data Feature",
      level: "feature",
      status: "pending",
      description: "Train ML models on historical data for predictive analytics",
    }, epicId);

    await expect(
      runScopedConsolidationPass(rexDir, store, featureBId, {}),
    ).rejects.toThrow("LLM rename produced a collision");
  });

  it("skips rename path when --no-reshape is set", async () => {
    const { runScopedConsolidationPass } = await import(
      "../../src/cli/commands/add-reshape.js"
    );
    const renameModule = await import("../../src/analyze/rename-resolve.js");
    const mockRename = vi.mocked(renameModule.proposeSiblingRenames);

    const store = await resolveStore(rexDir);

    const epicId = randomUUID();
    const featureAId = randomUUID();
    const featureBId = randomUUID();

    await store.addItem({ id: epicId, title: "System", level: "epic", status: "pending" });
    await store.addItem({
      id: featureAId,
      title: "Implement Auth",
      level: "feature",
      status: "pending",
      description: "OAuth2 social provider integration for login",
    }, epicId);
    await store.addItem({
      id: featureBId,
      title: "Implement Auth",
      level: "feature",
      status: "pending",
      description: "Machine learning based anomaly detection for auth requests",
    }, epicId);

    const result = await runScopedConsolidationPass(rexDir, store, featureBId, {
      "no-reshape": "true",
    });

    expect(result.renamedCount).toBe(0);
    expect(result.strategy).toBe("none");
    expect(mockRename).not.toHaveBeenCalled();
  });
});
