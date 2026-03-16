import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PRDDocument } from "../../../../src/schema/index.js";

async function writeFixtureProject(dir: string): Promise<void> {
  await mkdir(join(dir, ".rex"), { recursive: true });
  await mkdir(join(dir, ".sourcevision"), { recursive: true });

  await writeFile(
    join(dir, ".rex", "config.json"),
    JSON.stringify({
      schema: "rex/v1",
      project: "test-project",
      adapter: "file",
    }),
    "utf-8",
  );

  await writeFile(
    join(dir, ".rex", "prd.json"),
    JSON.stringify({
      schema: "rex/v1",
      title: "test-project",
      items: [],
    }),
    "utf-8",
  );

  await writeFile(
    join(dir, ".sourcevision", "zones.json"),
    JSON.stringify({
      findings: [
        { severity: "warning", category: "auth", message: "Auth finding A" },
        { severity: "warning", category: "perf", message: "Perf finding A" },
        { severity: "warning", category: "security", message: "Security finding A" },
        { severity: "critical", category: "auth", message: "Auth finding B" },
      ],
    }),
    "utf-8",
  );
}

async function readPrdItems(dir: string): Promise<PRDDocument["items"]> {
  const raw = await readFile(join(dir, ".rex", "prd.json"), "utf-8");
  const doc = JSON.parse(raw) as PRDDocument;
  return doc.items;
}

type AnyItem = PRDDocument["items"][0];

function flattenItems(items: AnyItem[]): AnyItem[] {
  const result: AnyItem[] = [];
  for (const item of items) {
    result.push(item);
    if (item.children) result.push(...flattenItems(item.children));
  }
  return result;
}

function filterByLevel(items: AnyItem[], level: string): AnyItem[] {
  return flattenItems(items).filter((i) => i.level === level);
}

async function writeFindings(
  dir: string,
  findings: Array<{ severity: string; category: string; message: string }>,
): Promise<void> {
  await writeFile(
    join(dir, ".sourcevision", "zones.json"),
    JSON.stringify({ findings }),
    "utf-8",
  );
}

describe("cmdRecommend --accept indexed selection", () => {
  let tmpDir: string;
  let cmdRecommend: typeof import("../../../../src/cli/commands/recommend.js")["cmdRecommend"];
  let parseSelectionIndices: typeof import("../../../../src/cli/commands/recommend.js")["parseSelectionIndices"];

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("@n-dx/llm-client", () => ({
      PROJECT_DIRS: {
        REX: ".rex",
        SOURCEVISION: ".sourcevision",
      },
      formatUsage: () => "",
      toCanonicalJSON: (value: unknown) => JSON.stringify(value, null, 2),
      result: () => {},
      info: () => {},
      setQuiet: () => {},
      isQuiet: () => false,
    }));
    ({ cmdRecommend, parseSelectionIndices } = await import("../../../../src/cli/commands/recommend.js"));

    tmpDir = await mkdtemp(join(tmpdir(), "rex-recommend-test-"));
    await writeFixtureProject(tmpDir);
  });

  afterEach(async () => {
    vi.doUnmock("@n-dx/llm-client");
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("accepts only specified recommendation indices", async () => {
    await cmdRecommend(tmpDir, { accept: "=2" });

    const items = await readPrdItems(tmpDir);
    const tasks = filterByLevel(items, "task");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toContain("Fix perf in global");
    expect(tasks[0].status).toBe("pending");
    // Should also have structural parents
    expect(items).toHaveLength(1); // 1 epic at root
    expect(items[0].level).toBe("epic");
  });

  it("preserves recommendation list order for accepted subset", async () => {
    await cmdRecommend(tmpDir, { accept: "=3,1" });

    const items = await readPrdItems(tmpDir);
    const tasks = filterByLevel(items, "task");
    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toContain("Fix auth in global");
    expect(tasks[1].title).toContain("Fix security in global");
  });

  it("parses equals-prefixed indices with commas and whitespace", async () => {
    await writeFindings(tmpDir, [
      { severity: "warning", category: "auth", message: "Auth finding" },
      { severity: "warning", category: "perf", message: "Perf finding" },
      { severity: "warning", category: "security", message: "Security finding" },
      { severity: "warning", category: "docs", message: "Docs finding" },
      { severity: "warning", category: "ops", message: "Ops finding" },
    ]);

    await cmdRecommend(tmpDir, { accept: "=1, 4, 5" });

    const items = await readPrdItems(tmpDir);
    const tasks = filterByLevel(items, "task");
    expect(tasks).toHaveLength(3);
    expect(tasks[0].title).toContain("Fix auth in global");
    expect(tasks[1].title).toContain("Fix docs in global");
    expect(tasks[2].title).toContain("Fix ops in global");
  });

  it("keeps all-accept behavior when no equals selector is provided", async () => {
    await cmdRecommend(tmpDir, { accept: "true" });

    const items = await readPrdItems(tmpDir);
    const tasks = filterByLevel(items, "task");
    expect(tasks).toHaveLength(3);
  });

  it("rejects selector values without '=' prefix", async () => {
    await expect(cmdRecommend(tmpDir, { accept: "1,3" })).rejects.toThrowError(
      /Invalid --accept selector format/i,
    );
  });

  it("rejects out-of-range selector values", async () => {
    await expect(cmdRecommend(tmpDir, { accept: "=9" })).rejects.toThrowError(
      /between 1 and 3/i,
    );
  });

  it("de-duplicates repeated selector indices before applying", async () => {
    await cmdRecommend(tmpDir, { accept: "=2,2,2" });

    const items = await readPrdItems(tmpDir);
    const tasks = filterByLevel(items, "task");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toContain("Fix perf in global");
  });

  // ── Wildcard / =all syntax ──────────────────────────────────────────

  it("accepts all recommendations with =all selector", async () => {
    await cmdRecommend(tmpDir, { accept: "=all" });

    const items = await readPrdItems(tmpDir);
    const tasks = filterByLevel(items, "task");
    expect(tasks).toHaveLength(3);
    expect(tasks[0].title).toContain("Fix auth in global");
    expect(tasks[1].title).toContain("Fix perf in global");
    expect(tasks[2].title).toContain("Fix security in global");
  });

  it("=all and --accept=true produce equivalent results", async () => {
    // Accept with =all
    await cmdRecommend(tmpDir, { accept: "=all" });
    const itemsAll = flattenItems(await readPrdItems(tmpDir));

    // Reset PRD
    await writeFile(
      join(tmpDir, ".rex", "prd.json"),
      JSON.stringify({ schema: "rex/v1", title: "test-project", items: [] }),
      "utf-8",
    );

    // Accept with true (legacy)
    await cmdRecommend(tmpDir, { accept: "true" });
    const itemsTrue = flattenItems(await readPrdItems(tmpDir));

    expect(itemsAll.length).toBe(itemsTrue.length);
    for (let i = 0; i < itemsAll.length; i++) {
      expect(itemsAll[i].title).toBe(itemsTrue[i].title);
      expect(itemsAll[i].level).toBe(itemsTrue[i].level);
      expect(itemsAll[i].priority).toBe(itemsTrue[i].priority);
    }
  });

  // ── Wildcard / =. (period) syntax ───────────────────────────────────

  it("accepts all recommendations with =. selector", async () => {
    await cmdRecommend(tmpDir, { accept: "=." });

    const items = await readPrdItems(tmpDir);
    const tasks = filterByLevel(items, "task");
    expect(tasks).toHaveLength(3);
    expect(tasks[0].title).toContain("Fix auth in global");
    expect(tasks[1].title).toContain("Fix perf in global");
    expect(tasks[2].title).toContain("Fix security in global");
  });

  it("=. and =all produce equivalent results", async () => {
    // Accept with =.
    await cmdRecommend(tmpDir, { accept: "=." });
    const itemsDot = flattenItems(await readPrdItems(tmpDir));

    // Reset PRD
    await writeFile(
      join(tmpDir, ".rex", "prd.json"),
      JSON.stringify({ schema: "rex/v1", title: "test-project", items: [] }),
      "utf-8",
    );

    // Accept with =all
    await cmdRecommend(tmpDir, { accept: "=all" });
    const itemsAll = flattenItems(await readPrdItems(tmpDir));

    expect(itemsDot.length).toBe(itemsAll.length);
    for (let i = 0; i < itemsDot.length; i++) {
      expect(itemsDot[i].title).toBe(itemsAll[i].title);
      expect(itemsDot[i].level).toBe(itemsAll[i].level);
      expect(itemsDot[i].priority).toBe(itemsAll[i].priority);
    }
  });

  it("=. is a no-op when no findings exist", async () => {
    await writeFindings(tmpDir, []);

    // Should not throw; no recommendations to accept
    await cmdRecommend(tmpDir, { accept: "=." });

    const items = await readPrdItems(tmpDir);
    expect(items).toHaveLength(0);
  });

  // ── Single-recommendation scenarios ─────────────────────────────────

  it("works with a single recommendation (total=1, select=1)", async () => {
    await writeFindings(tmpDir, [
      { severity: "critical", category: "auth", message: "Auth finding" },
    ]);

    await cmdRecommend(tmpDir, { accept: "=1" });

    const items = await readPrdItems(tmpDir);
    const tasks = filterByLevel(items, "task");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toContain("Fix auth in global");
  });

  // ── Selecting all indices explicitly ────────────────────────────────

  it("accepts all when every index is explicitly listed", async () => {
    await cmdRecommend(tmpDir, { accept: "=1,2,3" });

    const items = await readPrdItems(tmpDir);
    const tasks = filterByLevel(items, "task");
    expect(tasks).toHaveLength(3);
  });

  // ── Metadata preservation through CLI accept flow ───────────────────

  it("preserves recommendation metadata through the accept pipeline", async () => {
    await writeFindings(tmpDir, [
      { severity: "critical", category: "auth", message: "Critical auth" },
      { severity: "warning", category: "auth", message: "Warning auth" },
    ]);

    await cmdRecommend(tmpDir, { accept: "=1" });

    const items = await readPrdItems(tmpDir);
    const tasks = filterByLevel(items, "task");
    expect(tasks).toHaveLength(1);
    const meta = tasks[0].recommendationMeta as Record<string, unknown>;
    expect(meta).toBeDefined();
    expect(meta.category).toBe("auth");
    expect(meta.findingCount).toBe(2);
    expect(meta.severityDistribution).toEqual({ critical: 1, warning: 1 });
  });

  it("sets priority to critical when any finding in the group is critical", async () => {
    await writeFindings(tmpDir, [
      { severity: "warning", category: "auth", message: "Warning auth" },
      { severity: "critical", category: "auth", message: "Critical auth" },
    ]);

    await cmdRecommend(tmpDir, { accept: "=1" });

    const items = await readPrdItems(tmpDir);
    const tasks = filterByLevel(items, "task");
    expect(tasks[0].priority).toBe("critical");
  });

  it("sets priority to high when all findings in a group are warnings", async () => {
    await writeFindings(tmpDir, [
      { severity: "warning", category: "perf", message: "Warning perf A" },
      { severity: "warning", category: "perf", message: "Warning perf B" },
    ]);

    await cmdRecommend(tmpDir, { accept: "=1" });

    const items = await readPrdItems(tmpDir);
    const tasks = filterByLevel(items, "task");
    expect(tasks[0].priority).toBe("high");
  });

  // ── No-op when no recommendations match ─────────────────────────────

  it("does not modify PRD when no findings exist", async () => {
    await writeFindings(tmpDir, []);

    // Should not throw; no recommendations to accept
    await cmdRecommend(tmpDir, { accept: "true" });

    const items = await readPrdItems(tmpDir);
    expect(items).toHaveLength(0);
  });

  // ── parseSelectionIndices ───────────────────────────────────────────

  describe("parseSelectionIndices", () => {
    it("parses valid equals-prefixed selectors", () => {
      expect(parseSelectionIndices("=1,4,5", 5)).toEqual([0, 3, 4]);
      expect(parseSelectionIndices("=5,1,5", 5)).toEqual([0, 4]);
    });

    it("throws for invalid syntax", () => {
      expect(() => parseSelectionIndices("=one,two", 5)).toThrowError(
        /Invalid --accept selector token/i,
      );
      expect(() => parseSelectionIndices("=1,,x", 5)).toThrowError(
        /Invalid --accept selector token/i,
      );
    });

    it("throws for out-of-range values", () => {
      expect(() => parseSelectionIndices("=0,1,6", 5)).toThrowError(
        /between 1 and 5/i,
      );
      expect(() => parseSelectionIndices("=99", 5)).toThrowError(
        /between 1 and 5/i,
      );
    });

    it("handles mixed whitespace", () => {
      expect(parseSelectionIndices("= 1,\t2  3,\n4 ", 5)).toEqual([0, 1, 2, 3]);
    });

    // ── =all wildcard ───────────────────────────────────────────────

    it("returns empty array for =all (means select all)", () => {
      const result = parseSelectionIndices("=all", 10);
      expect(result).toEqual([]);
    });

    it("returns empty array for =all regardless of total count", () => {
      expect(parseSelectionIndices("=all", 1)).toEqual([]);
      expect(parseSelectionIndices("=all", 100)).toEqual([]);
    });

    // ── =. (period) wildcard ────────────────────────────────────────

    it("returns empty array for =. (means select all)", () => {
      const result = parseSelectionIndices("=.", 10);
      expect(result).toEqual([]);
    });

    it("returns empty array for =. regardless of total count", () => {
      expect(parseSelectionIndices("=.", 1)).toEqual([]);
      expect(parseSelectionIndices("=.", 100)).toEqual([]);
    });

    // ── Single index ────────────────────────────────────────────────

    it("parses a single index", () => {
      expect(parseSelectionIndices("=1", 5)).toEqual([0]);
      expect(parseSelectionIndices("=5", 5)).toEqual([4]);
    });

    it("parses a single index at total boundary", () => {
      expect(parseSelectionIndices("=1", 1)).toEqual([0]);
    });

    // ── Deduplication ───────────────────────────────────────────────

    it("deduplicates repeated indices", () => {
      expect(parseSelectionIndices("=3,3,3", 5)).toEqual([2]);
      expect(parseSelectionIndices("=1,2,1,3,2", 5)).toEqual([0, 1, 2]);
    });

    // ── Sorting ─────────────────────────────────────────────────────

    it("returns indices in ascending order regardless of input order", () => {
      expect(parseSelectionIndices("=5,3,1,4,2", 5)).toEqual([0, 1, 2, 3, 4]);
      expect(parseSelectionIndices("=3,1", 5)).toEqual([0, 2]);
    });

    // ── Whitespace variations ───────────────────────────────────────

    it("handles leading/trailing whitespace around the selector", () => {
      expect(parseSelectionIndices("  =1,2  ", 5)).toEqual([0, 1]);
    });

    it("handles spaces after =", () => {
      expect(parseSelectionIndices("=  1, 2, 3", 5)).toEqual([0, 1, 2]);
    });

    it("handles tab-separated indices", () => {
      expect(parseSelectionIndices("=1\t2\t3", 5)).toEqual([0, 1, 2]);
    });

    it("handles trailing commas gracefully", () => {
      // Trailing commas produce empty strings that are filtered out
      expect(parseSelectionIndices("=1,2,3,", 5)).toEqual([0, 1, 2]);
    });

    it("handles leading commas gracefully", () => {
      expect(parseSelectionIndices("=,1,2", 5)).toEqual([0, 1]);
    });

    // ── Error: missing = prefix ─────────────────────────────────────

    it("throws when = prefix is missing", () => {
      expect(() => parseSelectionIndices("1,2,3", 5)).toThrowError(
        /Invalid --accept selector format/i,
      );
    });

    // ── Error: empty after = ────────────────────────────────────────

    it("throws for empty value after =", () => {
      expect(() => parseSelectionIndices("=", 5)).toThrowError(
        /Expected one or more indices/i,
      );
    });

    it("throws for only whitespace after =", () => {
      expect(() => parseSelectionIndices("=   ", 5)).toThrowError(
        /Expected one or more indices/i,
      );
    });

    // ── Error: non-numeric tokens ───────────────────────────────────

    it("throws for decimal numbers", () => {
      expect(() => parseSelectionIndices("=1.5", 5)).toThrowError(
        /Invalid --accept selector token '1.5'/i,
      );
    });

    it("throws for negative numbers", () => {
      expect(() => parseSelectionIndices("=-1", 5)).toThrowError(
        /Invalid --accept selector token '-1'/i,
      );
    });

    it("throws for special characters", () => {
      expect(() => parseSelectionIndices("=1,@,3", 5)).toThrowError(
        /Invalid --accept selector token '@'/i,
      );
    });

    it("throws for mixed valid and invalid tokens", () => {
      expect(() => parseSelectionIndices("=1,abc,3", 5)).toThrowError(
        /Invalid --accept selector token 'abc'/i,
      );
    });

    // ── Error: index out of range ───────────────────────────────────

    it("throws for index 0 (below valid range)", () => {
      expect(() => parseSelectionIndices("=0", 5)).toThrowError(
        /between 1 and 5/i,
      );
    });

    it("throws for index above total", () => {
      expect(() => parseSelectionIndices("=6", 5)).toThrowError(
        /between 1 and 5/i,
      );
    });

    it("throws for very large index", () => {
      expect(() => parseSelectionIndices("=999999", 5)).toThrowError(
        /between 1 and 5/i,
      );
    });

    it("includes correct range in error message", () => {
      expect(() => parseSelectionIndices("=10", 3)).toThrowError(
        /between 1 and 3/,
      );
      expect(() => parseSelectionIndices("=0", 1)).toThrowError(
        /between 1 and 1/,
      );
    });

    // ── Error: includes helpful example ─────────────────────────────

    it("includes usage example in format errors", () => {
      expect(() => parseSelectionIndices("1,2", 5)).toThrowError(
        /Example: rex recommend --accept='=1,4,5'/,
      );
    });

    // ── Correction hints ─────────────────────────────────────────────

    it("suggests corrected form when = prefix is missing and input looks like indices", () => {
      expect(() => parseSelectionIndices("1,3,5", 5)).toThrowError(
        /Did you mean '--accept==1,3,5'/,
      );
    });

    it("suggests corrected form with cleaned whitespace", () => {
      expect(() => parseSelectionIndices("1 3 5", 5)).toThrowError(
        /Did you mean '--accept==1,3,5'/,
      );
    });

    it("does not suggest correction for non-numeric missing-prefix input", () => {
      try {
        parseSelectionIndices("abc", 5);
      } catch (err) {
        expect((err as Error).message).not.toContain("Did you mean");
        expect((err as Error).message).toContain("Invalid --accept selector format");
      }
    });

    // ── Case-insensitive =all ────────────────────────────────────────

    it("accepts =ALL (uppercase) as wildcard", () => {
      expect(parseSelectionIndices("=ALL", 5)).toEqual([]);
    });

    it("accepts =All (mixed case) as wildcard", () => {
      expect(parseSelectionIndices("=All", 5)).toEqual([]);
    });

    it("accepts =aLl (mixed case) as wildcard", () => {
      expect(parseSelectionIndices("=aLl", 5)).toEqual([]);
    });

    // ── Near-misspelling detection ──────────────────────────────────

    it("detects 'al' as near-misspelling of 'all' and suggests correction", () => {
      expect(() => parseSelectionIndices("=al", 5)).toThrowError(
        /Did you mean '=all'/,
      );
    });

    it("detects 'alll' as near-misspelling of 'all' and suggests correction", () => {
      expect(() => parseSelectionIndices("=alll", 5)).toThrowError(
        /Did you mean '=all'/,
      );
    });

    it("detects 'aall' as near-misspelling of 'all' and suggests correction", () => {
      expect(() => parseSelectionIndices("=aall", 5)).toThrowError(
        /Did you mean '=all'/,
      );
    });

    it("detects 'AL' as near-misspelling of 'all' and suggests correction", () => {
      expect(() => parseSelectionIndices("=AL", 5)).toThrowError(
        /Did you mean '=all'/,
      );
    });

    it("includes the misspelled keyword in the error", () => {
      expect(() => parseSelectionIndices("=alll", 5)).toThrowError(
        /Unknown selector keyword 'alll'/,
      );
    });

    // ── Empty recommendation list (total=0) ─────────────────────────

    it("throws specific error when total is 0 with index selector", () => {
      expect(() => parseSelectionIndices("=1", 0)).toThrowError(
        /No recommendations available to select from/,
      );
    });

    it("does not mention 'between 1 and 0' when total is 0", () => {
      try {
        parseSelectionIndices("=1", 0);
      } catch (err) {
        expect((err as Error).message).not.toContain("between 1 and 0");
      }
    });

    it("suggests running without --accept when total is 0", () => {
      expect(() => parseSelectionIndices("=1", 0)).toThrowError(
        /Run 'rex recommend' without --accept/,
      );
    });

    it("wildcards still work with total=0 (=all)", () => {
      expect(parseSelectionIndices("=all", 0)).toEqual([]);
    });

    it("wildcards still work with total=0 (=.)", () => {
      expect(parseSelectionIndices("=.", 0)).toEqual([]);
    });

    // ── Range syntax detection ──────────────────────────────────────

    it("detects range syntax '=1-3' and suggests expansion", () => {
      expect(() => parseSelectionIndices("=1-3", 5)).toThrowError(
        /Range syntax '1-3' is not supported/,
      );
    });

    it("suggests comma-separated expansion for range", () => {
      expect(() => parseSelectionIndices("=1-3", 5)).toThrowError(
        /Did you mean '=1,2,3'/,
      );
    });

    it("detects range syntax in multi-token context", () => {
      expect(() => parseSelectionIndices("=1,2-4,5", 5)).toThrowError(
        /Range syntax '2-4' is not supported/,
      );
    });

    it("suggests replacement for range in multi-token context", () => {
      expect(() => parseSelectionIndices("=1,2-4,5", 5)).toThrowError(
        /Replace '2-4' with '2,3,4'/,
      );
    });

    it("detects reversed range and explains the constraint", () => {
      expect(() => parseSelectionIndices("=5-1", 5)).toThrowError(
        /start must be ≤ end/,
      );
    });

    it("handles large range without expansion", () => {
      expect(() => parseSelectionIndices("=1-25", 30)).toThrowError(
        /Range syntax '1-25' is not supported.*=all/s,
      );
    });

    // ── Out-of-range with available indices hint ─────────────────────

    it("includes available indices hint when total > 1", () => {
      expect(() => parseSelectionIndices("=10", 5)).toThrowError(
        /Available indices: 1–5/,
      );
    });

    it("includes single-recommendation hint when total = 1", () => {
      expect(() => parseSelectionIndices("=5", 1)).toThrowError(
        /Only 1 recommendation is available \(use '=1'\)/,
      );
    });
  });

  // ── cmdRecommend edge cases ──────────────────────────────────────────

  describe("cmdRecommend accept edge cases", () => {
    it("accepts =ALL (uppercase) via cmdRecommend", async () => {
      await cmdRecommend(tmpDir, { accept: "=ALL" });

      const items = await readPrdItems(tmpDir);
      const tasks = filterByLevel(items, "task");
      expect(tasks).toHaveLength(3);
    });

    it("provides correction hint when = prefix missing and input looks like indices", async () => {
      await expect(cmdRecommend(tmpDir, { accept: "1,3" })).rejects.toThrowError(
        /Did you mean '--accept==1,3'/,
      );
    });

    it("handles empty findings list with accept flag gracefully", async () => {
      await writeFindings(tmpDir, []);

      // Should return early with no error
      await cmdRecommend(tmpDir, { accept: "true" });
      const items = await readPrdItems(tmpDir);
      expect(items).toHaveLength(0);
    });

    it("handles empty findings list with =. wildcard gracefully", async () => {
      await writeFindings(tmpDir, []);

      await cmdRecommend(tmpDir, { accept: "=." });
      const items = await readPrdItems(tmpDir);
      expect(items).toHaveLength(0);
    });
  });
});

// ── Creation confirmation and summary output ──────────────────────────────

describe("cmdRecommend --accept creation summary output", () => {
  let tmpDir: string;
  let cmdRecommend: typeof import("../../../../src/cli/commands/recommend.js")["cmdRecommend"];
  let resultCalls: string[];
  let infoCalls: string[];

  beforeEach(async () => {
    resultCalls = [];
    infoCalls = [];

    vi.resetModules();
    vi.doMock("@n-dx/llm-client", () => ({
      PROJECT_DIRS: {
        REX: ".rex",
        SOURCEVISION: ".sourcevision",
      },
      formatUsage: () => "",
      toCanonicalJSON: (value: unknown) => JSON.stringify(value, null, 2),
      result: (...args: unknown[]) => { resultCalls.push(args.map(String).join(" ")); },
      info: (...args: unknown[]) => { infoCalls.push(args.map(String).join(" ")); },
      setQuiet: () => {},
      isQuiet: () => false,
    }));
    ({ cmdRecommend } = await import("../../../../src/cli/commands/recommend.js"));

    tmpDir = await mkdtemp(join(tmpdir(), "rex-recommend-summary-"));
    await writeFixtureProject(tmpDir);
  });

  afterEach(async () => {
    vi.doUnmock("@n-dx/llm-client");
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ── Pre-creation summary ─────────────────────────────────────────────

  it("shows pre-creation summary listing selected recommendations", async () => {
    await cmdRecommend(tmpDir, { accept: "=1,3" });

    const summaryHeader = infoCalls.find((c) => c.includes("Creating 2 of 3 tasks"));
    expect(summaryHeader).toBeDefined();
  });

  it("shows pre-creation summary with each recommendation's priority, title, and level", async () => {
    await cmdRecommend(tmpDir, { accept: "=2" });

    const itemLine = infoCalls.find((c) => c.includes("[high]") && c.includes("Fix perf in global") && c.includes("(task)"));
    expect(itemLine).toBeDefined();
  });

  it("uses singular form for single recommendation", async () => {
    await writeFindings(tmpDir, [
      { severity: "warning", category: "auth", message: "Auth finding" },
    ]);

    await cmdRecommend(tmpDir, { accept: "=1" });

    const header = infoCalls.find((c) => c.includes("Creating 1 task"));
    expect(header).toBeDefined();
  });

  it("shows 'N of M' when accepting a subset", async () => {
    await cmdRecommend(tmpDir, { accept: "=1" });

    const header = infoCalls.find((c) => c.includes("Creating 1 of 3 tasks"));
    expect(header).toBeDefined();
  });

  it("omits 'of M' when accepting all", async () => {
    await cmdRecommend(tmpDir, { accept: "true" });

    // Should show "Creating 3 tasks" without "of 3"
    const header = infoCalls.find((c) => /Creating 3 task/.test(c));
    expect(header).toBeDefined();
    // Should NOT say "of 3" since all are selected
    const subsetHeader = infoCalls.find((c) => c.includes("of 3 task"));
    expect(subsetHeader).toBeUndefined();
  });

  // ── Post-creation results ────────────────────────────────────────────

  it("shows success marker and PRD item ID for each created item", async () => {
    await cmdRecommend(tmpDir, { accept: "=2" });

    const items = await readPrdItems(tmpDir);
    const tasks = filterByLevel(items, "task");
    const successLine = resultCalls.find(
      (c) => c.includes("✓") && c.includes(tasks[0].id) && c.includes("Fix perf in global"),
    );
    expect(successLine).toBeDefined();
  });

  it("shows hierarchy level in creation results", async () => {
    await cmdRecommend(tmpDir, { accept: "=1" });

    const items = await readPrdItems(tmpDir);
    const tasks = filterByLevel(items, "task");
    const successLine = resultCalls.find(
      (c) => c.includes("✓") && c.includes("task") && c.includes(tasks[0].id),
    );
    expect(successLine).toBeDefined();
  });

  it("shows root placement for epic", async () => {
    await cmdRecommend(tmpDir, { accept: "=1" });

    const rootLine = resultCalls.find((c) => c.includes("(root)"));
    expect(rootLine).toBeDefined();
  });

  it("shows total count of created vs selected tasks", async () => {
    await cmdRecommend(tmpDir, { accept: "=1,3" });

    // reportCreationResults counts all created items (epic + features + tasks)
    // but the total denominator is the number of selected tasks
    const countLine = resultCalls.find((c) => c.includes("selected recommendation") && c.includes("created"));
    expect(countLine).toBeDefined();
  });

  it("shows singular form for single item in count", async () => {
    await writeFindings(tmpDir, [
      { severity: "warning", category: "auth", message: "Auth finding" },
    ]);

    await cmdRecommend(tmpDir, { accept: "=1" });

    const countLine = resultCalls.find((c) => c.includes("selected recommendation") && c.includes("created"));
    expect(countLine).toBeDefined();
  });

  it("shows all created items with their IDs for multi-item accept", async () => {
    await cmdRecommend(tmpDir, { accept: "=all" });

    const items = await readPrdItems(tmpDir);
    const allItems = flattenItems(items);

    // Each created item should have a success line with its ID
    for (const item of allItems) {
      const successLine = resultCalls.find((c) => c.includes(item.id));
      expect(successLine).toBeDefined();
    }
  });

  it("shows task count when accepting all 3 recommendations", async () => {
    await cmdRecommend(tmpDir, { accept: "=all" });

    const countLine = resultCalls.find((c) => c.includes("3/3 selected recommendations created"));
    expect(countLine).toBeDefined();
  });

  // ── Pre-creation summary lists correct items for selective accept ───

  it("lists only selected tasks and their structural parents in pre-creation summary", async () => {
    await cmdRecommend(tmpDir, { accept: "=2" });

    // Should list the perf task
    const perfLine = infoCalls.find((c) => c.includes("Fix perf in global") && c.includes("(task)"));
    expect(perfLine).toBeDefined();

    // Should NOT list auth or security tasks in summary
    const authTaskLine = infoCalls.find((c) => c.includes("Fix auth in global") && c.includes("(task)"));
    expect(authTaskLine).toBeUndefined();
  });
});

// ── Conflict detection in cmdRecommend ──────────────────────────────────

describe("cmdRecommend --accept conflict detection", () => {
  let tmpDir: string;
  let cmdRecommend: typeof import("../../../../src/cli/commands/recommend.js")["cmdRecommend"];
  let resultCalls: string[];
  let infoCalls: string[];

  beforeEach(async () => {
    resultCalls = [];
    infoCalls = [];

    vi.resetModules();
    vi.doMock("@n-dx/llm-client", () => ({
      PROJECT_DIRS: {
        REX: ".rex",
        SOURCEVISION: ".sourcevision",
      },
      formatUsage: () => "",
      toCanonicalJSON: (value: unknown) => JSON.stringify(value, null, 2),
      result: (...args: unknown[]) => { resultCalls.push(args.map(String).join(" ")); },
      info: (...args: unknown[]) => { infoCalls.push(args.map(String).join(" ")); },
      setQuiet: () => {},
      isQuiet: () => false,
    }));
    ({ cmdRecommend } = await import("../../../../src/cli/commands/recommend.js"));

    tmpDir = await mkdtemp(join(tmpdir(), "rex-recommend-conflict-"));
    await writeFixtureProject(tmpDir);
  });

  afterEach(async () => {
    vi.doUnmock("@n-dx/llm-client");
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("creates all items including when existing items have similar titles (force for hierarchy)", async () => {
    // Pre-populate PRD with an item that has a similar title to a task recommendation
    await writeFile(
      join(tmpDir, ".rex", "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "test-project",
        items: [
          {
            id: "existing-auth",
            title: "Fix auth in global: Auth finding A (+1 more)",
            status: "pending",
            level: "task",
          },
        ],
      }),
      "utf-8",
    );

    // Hierarchical recommendations always use "force" strategy, so all items
    // are created even when existing items have similar titles. Dedup is handled
    // upstream by the finding acknowledgment system.
    await cmdRecommend(tmpDir, { accept: "=all" });

    const items = await readPrdItems(tmpDir);
    const allItems = flattenItems(items);
    // Existing item preserved + new hierarchy created
    expect(allItems.find((i) => i.id === "existing-auth")).toBeDefined();
    const tasks = allItems.filter((i) => i.level === "task" && i.id !== "existing-auth");
    expect(tasks).toHaveLength(3);
  });

  it("creates all items with --force flag explicitly", async () => {
    await writeFile(
      join(tmpDir, ".rex", "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "test-project",
        items: [
          {
            id: "existing-auth",
            title: "Fix auth in global: Auth finding A (+1 more)",
            status: "pending",
            level: "task",
          },
        ],
      }),
      "utf-8",
    );

    await cmdRecommend(tmpDir, { accept: "=all", force: "" });

    const items = await readPrdItems(tmpDir);
    const allItems = flattenItems(items);
    // Existing + epic + 3 features + 3 tasks = 8
    expect(allItems.length).toBeGreaterThanOrEqual(8);
  });

  it("creates all items with no conflicts and shows task count", async () => {
    // Default fixture has empty PRD - no conflicts possible
    await cmdRecommend(tmpDir, { accept: "=all" });

    const items = await readPrdItems(tmpDir);
    const tasks = filterByLevel(items, "task");
    expect(tasks).toHaveLength(3); // All 3 tasks

    // Should show standard count without "skipped"
    const countLine = resultCalls.find((c) => c.includes("3/3") && c.includes("created"));
    expect(countLine).toBeDefined();
    const skippedLine = resultCalls.find((c) => c.includes("skipped"));
    expect(skippedLine).toBeUndefined();
  });
});

// ── --actionable-only filter ──────────────────────────────────────────────

describe("cmdRecommend --actionable-only", () => {
  let tmpDir: string;
  let cmdRecommend: typeof import("../../../../src/cli/commands/recommend.js")["cmdRecommend"];
  let resultCalls: string[];
  let infoCalls: string[];

  beforeEach(async () => {
    resultCalls = [];
    infoCalls = [];

    vi.resetModules();
    vi.doMock("@n-dx/llm-client", () => ({
      PROJECT_DIRS: {
        REX: ".rex",
        SOURCEVISION: ".sourcevision",
      },
      formatUsage: () => "",
      toCanonicalJSON: (value: unknown) => JSON.stringify(value, null, 2),
      result: (...args: unknown[]) => { resultCalls.push(args.map(String).join(" ")); },
      info: (...args: unknown[]) => { infoCalls.push(args.map(String).join(" ")); },
      setQuiet: () => {},
      isQuiet: () => false,
    }));
    ({ cmdRecommend } = await import("../../../../src/cli/commands/recommend.js"));

    tmpDir = await mkdtemp(join(tmpdir(), "rex-recommend-actionable-"));
    await mkdir(join(tmpDir, ".rex"), { recursive: true });
    await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });

    await writeFile(
      join(tmpDir, ".rex", "config.json"),
      JSON.stringify({ schema: "rex/v1", project: "test", adapter: "file" }),
      "utf-8",
    );
    await writeFile(
      join(tmpDir, ".rex", "prd.json"),
      JSON.stringify({ schema: "rex/v1", title: "test", items: [] }),
      "utf-8",
    );
  });

  afterEach(async () => {
    vi.doUnmock("@n-dx/llm-client");
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("filters out observation and pattern types", async () => {
    await writeFile(
      join(tmpDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        findings: [
          { type: "observation", severity: "warning", text: "Contains 52% of files", scope: "core" },
          { type: "pattern", severity: "warning", text: "Barrel exports used", scope: "core" },
          { type: "anti-pattern", severity: "warning", text: "God object detected", scope: "core" },
          { type: "suggestion", severity: "warning", text: "Consider splitting module", scope: "core" },
        ],
      }),
      "utf-8",
    );

    await cmdRecommend(tmpDir, { "actionable-only": "" });

    // Should only show anti-pattern and suggestion
    const tasks = resultCalls.filter((c) => /^\s+\d+\./.test(c));
    expect(tasks).toHaveLength(2);
  });

  it("keeps move-file type findings", async () => {
    await writeFile(
      join(tmpDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        findings: [
          { type: "move-file", severity: "warning", text: "Move utils.ts to shared/", scope: "core" },
          { type: "relationship", severity: "warning", text: "High coupling between A and B", scope: "core" },
        ],
      }),
      "utf-8",
    );

    await cmdRecommend(tmpDir, { "actionable-only": "" });

    const tasks = resultCalls.filter((c) => /^\s+\d+\./.test(c));
    expect(tasks).toHaveLength(1);
  });

  it("shows filtered-out count when all findings are non-actionable", async () => {
    await writeFile(
      join(tmpDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        findings: [
          { type: "observation", severity: "warning", text: "Zone has 3 files", scope: "core" },
          { type: "pattern", severity: "warning", text: "Uses barrel exports", scope: "core" },
        ],
      }),
      "utf-8",
    );

    await cmdRecommend(tmpDir, { "actionable-only": "" });

    const noFindings = resultCalls.find((c) => c.includes("No findings to recommend"));
    expect(noFindings).toBeDefined();
    const filteredMsg = infoCalls.find((c) => c.includes("filtered out by --actionable-only"));
    expect(filteredMsg).toBeDefined();
  });

  it("shows all findings without --actionable-only flag", async () => {
    await writeFile(
      join(tmpDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        findings: [
          { type: "observation", severity: "warning", text: "Contains 52% of files", scope: "core" },
          { type: "anti-pattern", severity: "warning", text: "God object detected", scope: "core" },
        ],
      }),
      "utf-8",
    );

    await cmdRecommend(tmpDir, {});

    // Without the flag, both findings should appear
    const tasks = resultCalls.filter((c) => /^\s+\d+\./.test(c));
    expect(tasks).toHaveLength(2);
  });
});
