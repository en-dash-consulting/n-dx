/**
 * Proposal accept paths keep the LoE fields the LLM produced.
 *
 * `rex analyze` accept and `rex add` (smart add) must persist `loe` (a number),
 * `loeRationale` and `loeConfidence` through the folder tree, and drop invalid
 * values. Reads go back through a fresh store so the serializer is exercised.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdInit } from "../../src/cli/commands/init.js";
import { cmdSmartAdd } from "../../src/cli/commands/smart-add.js";
import { buildAcceptedItems } from "../../src/cli/commands/analyze.js";
import { resolveStore, resolveRexPaths } from "../../src/store/index.js";
import { pickLoEFields } from "../../src/analyze/index.js";
import type { Proposal } from "../../src/analyze/index.js";
import type { PRDItem } from "../../src/schema/index.js";

const mockReasonFromDescriptions = vi.hoisted(() => vi.fn());

vi.mock("../../src/analyze/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/analyze/index.js")>(
    "../../src/analyze/index.js",
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

vi.mock("../../src/store/project-config.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/store/project-config.js")>(
    "../../src/store/project-config.js",
  );
  return {
    ...actual,
    loadLLMConfig: vi.fn().mockResolvedValue({}),
    loadClaudeConfig: vi.fn().mockResolvedValue({}),
  };
});

function proposal(): Proposal {
  return {
    epic: { title: "Billing", source: "test" },
    features: [
      {
        title: "Invoices",
        source: "test",
        tasks: [
          {
            title: "Valid LoE",
            source: "test",
            sourceFile: "",
            loe: 1.5,
            loeRationale: "Two endpoints and a migration",
            loeConfidence: "medium",
          },
          {
            title: "Invalid LoE",
            source: "test",
            sourceFile: "",
            loe: -1,
            loeConfidence: "certain" as unknown as "low",
          },
        ],
      },
    ],
  };
}

function findTasks(items: PRDItem[]): PRDItem[] {
  return items.flatMap((i) => (i.level === "task" ? [i] : findTasks(i.children ?? [])));
}

function expectLoEOnlyOnValid(tasks: PRDItem[]): void {
  const valid = tasks.find((t) => t.title === "Valid LoE")!;
  expect(valid.loe).toBe(1.5);
  expect(typeof valid.loe).toBe("number");
  expect(valid.loeRationale).toBe("Two endpoints and a migration");
  expect(valid.loeConfidence).toBe("medium");

  const invalid = tasks.find((t) => t.title === "Invalid LoE")!;
  expect(invalid).not.toHaveProperty("loe");
  expect(invalid).not.toHaveProperty("loeRationale");
  expect(invalid).not.toHaveProperty("loeConfidence");
}

describe("pickLoEFields", () => {
  it("keeps valid values and drops invalid ones", () => {
    expect(pickLoEFields({ loe: 2, loeRationale: "r", loeConfidence: "high" })).toEqual({
      loe: 2,
      loeRationale: "r",
      loeConfidence: "high",
    });
    expect(pickLoEFields({ loe: 0 })).toEqual({});
    expect(pickLoEFields({ loe: Number.POSITIVE_INFINITY })).toEqual({});
    expect(pickLoEFields({ loe: "2" as unknown as number })).toEqual({});
    expect(pickLoEFields({ loeConfidence: "certain" as unknown as "low" })).toEqual({});
    expect(pickLoEFields({})).toEqual({});
  });
});

describe("accept paths keep LoE through the folder tree", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-accept-loe-"));
    rexDir = resolveRexPaths(tmpDir).rexDir;
    await cmdInit(tmpDir, {});
    mockReasonFromDescriptions.mockReset();
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("rex analyze accept", async () => {
    const { items } = await buildAcceptedItems([proposal()]);
    const store = await resolveStore(rexDir);
    await store.withTransaction(async (doc) => {
      doc.items.push(...items);
    });

    const reread = await (await resolveStore(rexDir)).loadDocument();
    expectLoEOnlyOnValid(findTasks(reread.items));
  });

  it("smart add (rex add)", async () => {
    mockReasonFromDescriptions.mockResolvedValue({
      proposals: [proposal()],
      tokenUsage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        estimatedCostUsd: 0,
        calls: 1,
      },
    });

    await cmdSmartAdd(tmpDir, "Add invoices", {});
    await cmdSmartAdd(tmpDir, [], { accept: "true" });

    const reread = await (await resolveStore(rexDir)).loadDocument();
    expectLoEOnlyOnValid(findTasks(reread.items));
  });
});
