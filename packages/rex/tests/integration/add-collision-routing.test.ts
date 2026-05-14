/**
 * Integration tests for title-collision duplicate routing via cmdAdd.
 *
 * Verifies that when two siblings share the same normalized title:
 *   - HIGH-similarity content (>= threshold) → merge path (reshape)
 *   - LOW-similarity content (< threshold)   → rename path (LLM)
 *
 * Also verifies that the threshold is configurable via .rex/config.json.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { cmdInit } from "../../src/cli/commands/init.js";
import { resolveStore } from "../../src/store/index.js";
import { REX_DIR } from "../../src/cli/commands/constants.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function setupDir(): Promise<{ tmpDir: string; rexDir: string }> {
  const tmpDir = await mkdtemp(join(tmpdir(), "rex-collision-routing-"));
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("add title-collision routing: merge vs rename", () => {
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

  it("high-similarity same-title siblings → merged (reshape path, LLM not called)", async () => {
    const { cmdAdd } = await import("../../src/cli/commands/add.js");
    const renameModule = await import("../../src/analyze/rename-resolve.js");
    const mockRename = vi.mocked(renameModule.proposeSiblingRenames);

    const store = await resolveStore(rexDir);
    const epicId = randomUUID();

    await store.addItem({ id: epicId, title: "Auth Epic", level: "epic", status: "pending" });

    // First feature — a description that's almost identical to the second
    const existingId = randomUUID();
    await store.addItem({
      id: existingId,
      title: "Implement OAuth Login",
      level: "feature",
      status: "pending",
      description: "Add OAuth2 social login with Google and GitHub to the authentication flow.",
    }, epicId);

    // Second feature — same title, highly similar description (≥ 0.5 similarity)
    await cmdAdd(tmpDir, "feature", {
      title: "Implement OAuth Login",
      parent: epicId,
      description: "Add OAuth2 social login with Google and GitHub to the auth flow.",
    });

    // High similarity → merge path: only one feature should remain
    const doc = await store.loadDocument();
    const epic = doc.items.find((i) => i.id === epicId)!;
    const features = epic.children?.filter((c) => c.level === "feature") ?? [];
    expect(features).toHaveLength(1);
    expect(features[0].title).toBe("Implement OAuth Login");

    // LLM rename must NOT have been called
    expect(mockRename).not.toHaveBeenCalled();
  });

  it("low-similarity same-title siblings → renamed (LLM path called)", async () => {
    const { cmdAdd } = await import("../../src/cli/commands/add.js");
    const renameModule = await import("../../src/analyze/rename-resolve.js");
    const mockRename = vi.mocked(renameModule.proposeSiblingRenames);

    mockRename.mockResolvedValueOnce({
      titleA: "OAuth2 Social Login",
      titleB: "API Token Management",
      reasoning: "Item A covers social OAuth; Item B covers programmatic API tokens",
    });

    const store = await resolveStore(rexDir);
    const epicId = randomUUID();

    await store.addItem({ id: epicId, title: "Auth Epic", level: "epic", status: "pending" });

    // First feature — semantically distinct from the second
    const existingId = randomUUID();
    await store.addItem({
      id: existingId,
      title: "Implement Auth",
      level: "feature",
      status: "pending",
      description: "Add OAuth2 social login with Google and GitHub provider support.",
    }, epicId);

    // Second feature — same title, semantically distinct description (< 0.5 similarity)
    await cmdAdd(tmpDir, "feature", {
      title: "Implement Auth",
      parent: epicId,
      description: "Build API token management with scoped access and revocation for programmatic use.",
    });

    // Low similarity → rename path: both features should remain with new distinct titles
    const doc = await store.loadDocument();
    const epic = doc.items.find((i) => i.id === epicId)!;
    const features = epic.children?.filter((c) => c.level === "feature") ?? [];
    expect(features).toHaveLength(2);

    const titles = features.map((f) => f.title);
    expect(titles).toContain("OAuth2 Social Login");
    expect(titles).toContain("API Token Management");

    // LLM rename must have been called once
    expect(mockRename).toHaveBeenCalledOnce();
  });

  it("configurable threshold: raising it routes a borderline pair to rename instead of merge", async () => {
    const { cmdAdd } = await import("../../src/cli/commands/add.js");
    const renameModule = await import("../../src/analyze/rename-resolve.js");
    const mockRename = vi.mocked(renameModule.proposeSiblingRenames);

    mockRename.mockResolvedValueOnce({
      titleA: "OAuth2 Social Login",
      titleB: "API Token Auth",
      reasoning: "Distinct auth mechanisms",
    });

    // Raise the threshold so that a pair which would ordinarily merge now renames
    const configPath = join(rexDir, "config.json");
    const configRaw = await readFile(configPath, "utf-8");
    const config = JSON.parse(configRaw) as Record<string, unknown>;
    config.titleCollisionSimilarityThreshold = 0.99; // nearly everything is "distinct"
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");

    const store = await resolveStore(rexDir);
    const epicId = randomUUID();

    await store.addItem({ id: epicId, title: "Auth Epic", level: "epic", status: "pending" });

    // Descriptions with high similarity (would merge at threshold 0.5)
    const existingId = randomUUID();
    await store.addItem({
      id: existingId,
      title: "Implement Login",
      level: "feature",
      status: "pending",
      description: "Add OAuth2 social login with Google and GitHub to the authentication flow.",
    }, epicId);

    await cmdAdd(tmpDir, "feature", {
      title: "Implement Login",
      parent: epicId,
      description: "Add OAuth2 social login with Google and GitHub to the auth flow.",
    });

    // With threshold=0.99, the high-similarity pair is treated as non-duplicate → rename
    expect(mockRename).toHaveBeenCalledOnce();

    const doc = await store.loadDocument();
    const epic = doc.items.find((i) => i.id === epicId)!;
    const features = epic.children?.filter((c) => c.level === "feature") ?? [];
    expect(features).toHaveLength(2);
  });
});
