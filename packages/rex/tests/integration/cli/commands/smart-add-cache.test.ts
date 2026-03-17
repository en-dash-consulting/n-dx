import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdInit } from "../../../../src/cli/commands/init.js";
import { cmdSmartAdd } from "../../../../src/cli/commands/smart-add.js";
import { resolveStore } from "../../../../src/store/index.js";
import { REX_DIR } from "../../../../src/cli/commands/constants.js";
import { hashPRD } from "../../../../src/core/pending-cache.js";
import type { Proposal } from "../../../../src/analyze/index.js";
import type { PRDItem } from "../../../../src/schema/index.js";

// ── Mocks ──

const mockReasonFromDescriptions = vi.hoisted(() => vi.fn());

vi.mock("../../../../src/analyze/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/analyze/index.js")>(
    "../../../../src/analyze/index.js",
  );
  return {
    ...actual,
    reasonFromDescriptions: mockReasonFromDescriptions,
    validateProposalQuality: vi.fn(() => []),
    setLLMConfig: vi.fn(),
    setClaudeConfig: vi.fn(),
    getAuthMode: vi.fn(() => "api"),
    getLLMVendor: vi.fn(() => "claude"),
  };
});

vi.mock("../../../../src/store/project-config.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/store/project-config.js")
  >("../../../../src/store/project-config.js");
  return {
    ...actual,
    loadLLMConfig: vi.fn().mockResolvedValue({}),
    loadClaudeConfig: vi.fn().mockResolvedValue({}),
  };
});

// ── Test data ──

const PENDING_FILE = "pending-smart-proposals.json";

const sampleProposal: Proposal = {
  epic: { title: "Auth System", source: "smart-add" },
  features: [
    {
      title: "Login Flow",
      source: "smart-add",
      tasks: [
        {
          title: "Build login form",
          source: "smart-add",
          sourceFile: "",
          description: "Create the login form component.",
          priority: "high",
        },
      ],
    },
  ],
};

const sampleItems: PRDItem[] = [
  {
    id: "epic-1",
    title: "Existing Epic",
    level: "epic",
    status: "pending",
    children: [
      {
        id: "feature-1",
        title: "Existing Feature",
        level: "feature",
        status: "pending",
        children: [
          {
            id: "task-1",
            title: "Existing Task",
            level: "task",
            status: "pending",
          },
        ],
      },
    ],
  },
];

function makeReasonResult(proposals: Proposal[]) {
  return {
    proposals,
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      estimatedCostUsd: 0.01,
      calls: 1,
    },
  };
}

async function seedPRD(dir: string, items: PRDItem[]): Promise<void> {
  const store = await resolveStore(join(dir, REX_DIR));
  const doc = await store.loadDocument();
  doc.items = items;
  await store.saveDocument(doc);
}

// ── Tests ──

describe("smart-add cache staleness integration", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-smart-add-cache-integ-"));
    rexDir = join(tmpDir, REX_DIR);
    await cmdInit(tmpDir, {});
    await seedPRD(tmpDir, sampleItems);
    mockReasonFromDescriptions.mockReset();
    mockReasonFromDescriptions.mockResolvedValue(makeReasonResult([sampleProposal]));
    // Disable TTY so interactive prompt is skipped
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("savePending writes prdHash to pending-proposals.json", async () => {
    // Generate proposals (non-accept mode) — triggers savePending with hash
    await cmdSmartAdd(tmpDir, "Add auth system", {});

    expect(mockReasonFromDescriptions).toHaveBeenCalledOnce();

    const raw = await readFile(join(rexDir, PENDING_FILE), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.prdHash).toMatch(/^[0-9a-f]{12}$/);
    expect(parsed.proposals).toHaveLength(1);
    expect(parsed.proposals[0].epic.title).toBe("Auth System");
  });

  it("loadPending returns prdHash from cached file", async () => {
    // Compute hash from the actual stored PRD (store may normalize items)
    const store = await resolveStore(rexDir);
    const doc = await store.loadDocument();
    const knownHash = hashPRD(doc.items);

    // Write a cache file manually with the correct hash
    const cacheData = {
      proposals: [sampleProposal],
      prdHash: knownHash,
    };
    await writeFile(join(rexDir, PENDING_FILE), JSON.stringify(cacheData, null, 2));

    // Accept mode with no descriptions → should load from cache
    // Since hash matches, it should succeed
    await cmdSmartAdd(tmpDir, [], { accept: "true" });

    // LLM should NOT have been called (cache was replayed)
    expect(mockReasonFromDescriptions).not.toHaveBeenCalled();

    // Cache should have been consumed — verify PRD now has the new items
    const doc2 = await store.loadDocument();
    const titles = flattenTitles(doc2.items);
    expect(titles).toContain("Auth System");
    expect(titles).toContain("Login Flow");
    expect(titles).toContain("Build login form");
  });

  it("--accept succeeds when PRD hash matches cached hash", async () => {
    // Step 1: generate and cache proposals
    await cmdSmartAdd(tmpDir, "Add auth system", {});
    expect(mockReasonFromDescriptions).toHaveBeenCalledOnce();

    // Step 2: accept cached proposals (PRD unchanged → hash matches)
    mockReasonFromDescriptions.mockClear();
    await cmdSmartAdd(tmpDir, [], { accept: "true" });
    expect(mockReasonFromDescriptions).not.toHaveBeenCalled();

    // Verify items were added
    const store = await resolveStore(rexDir);
    const doc = await store.loadDocument();
    const titles = flattenTitles(doc.items);
    expect(titles).toContain("Auth System");
  });

  it("--accept rejects stale cache when PRD has changed", async () => {
    // Step 1: generate and cache proposals
    await cmdSmartAdd(tmpDir, "Add auth system", {});
    expect(mockReasonFromDescriptions).toHaveBeenCalledOnce();

    // Verify cache exists with valid hash
    const rawBefore = await readFile(join(rexDir, PENDING_FILE), "utf-8");
    const cachedHash = JSON.parse(rawBefore).prdHash;
    expect(cachedHash).toMatch(/^[0-9a-f]{12}$/);

    // Step 2: modify PRD to invalidate hash
    const store = await resolveStore(rexDir);
    const doc = await store.loadDocument();
    doc.items[0]!.children![0]!.children!.push({
      id: "task-new",
      title: "Added after cache",
      level: "task",
      status: "pending",
    });
    await store.saveDocument(doc);

    // Step 3: attempt accept — staleness detected, cache cleared, command regenerates
    mockReasonFromDescriptions.mockClear();
    await cmdSmartAdd(tmpDir, [], { accept: "true" });

    // LLM was called again because stale cache was rejected and command continued
    expect(mockReasonFromDescriptions).toHaveBeenCalledOnce();

    // Cache is cleared after acceptProposals completes
    let cacheExists = true;
    try {
      await readFile(join(rexDir, PENDING_FILE), "utf-8");
    } catch {
      cacheExists = false;
    }
    expect(cacheExists).toBe(false);
  });

  it("--accept works with backward-compatible cache (no prdHash)", async () => {
    // Write a cache file WITHOUT prdHash (legacy format)
    const cacheData = {
      proposals: [sampleProposal],
      // no prdHash field
    };
    await writeFile(join(rexDir, PENDING_FILE), JSON.stringify(cacheData, null, 2));

    // Accept should proceed without validation since there's no hash to check
    await cmdSmartAdd(tmpDir, [], { accept: "true" });

    expect(mockReasonFromDescriptions).not.toHaveBeenCalled();

    // Verify items were added despite no prdHash
    const store = await resolveStore(rexDir);
    const doc = await store.loadDocument();
    const titles = flattenTitles(doc.items);
    expect(titles).toContain("Auth System");
    expect(titles).toContain("Build login form");
  });

  it("maybeCacheSmartAddProposals passes hash through to savePending", async () => {
    // Compute expected hash from actual stored PRD (store may normalize items)
    const store = await resolveStore(rexDir);
    const doc = await store.loadDocument();
    const expectedHash = hashPRD(doc.items);

    // Generate proposals — this triggers maybeCacheSmartAddProposals internally
    await cmdSmartAdd(tmpDir, "Add auth system", {});

    // Read the cached file and verify the hash matches actual stored PRD hash
    const raw = await readFile(join(rexDir, PENDING_FILE), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.prdHash).toBe(expectedHash);
  });
});

// ── Helpers ──

function flattenTitles(items: PRDItem[]): string[] {
  const titles: string[] = [];
  for (const item of items) {
    titles.push(item.title);
    if (item.children) titles.push(...flattenTitles(item.children));
  }
  return titles;
}
