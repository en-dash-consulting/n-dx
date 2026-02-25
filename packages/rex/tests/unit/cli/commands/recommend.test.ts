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
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("Address perf issues");
    expect(items[0].status).toBe("pending");
  });

  it("preserves recommendation list order for accepted subset", async () => {
    await cmdRecommend(tmpDir, { accept: "=3,1" });

    const items = await readPrdItems(tmpDir);
    expect(items).toHaveLength(2);
    expect(items[0].title).toContain("Address auth issues");
    expect(items[1].title).toContain("Address security issues");
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
    expect(items).toHaveLength(3);
    expect(items[0].title).toContain("Address auth issues");
    expect(items[1].title).toContain("Address docs issues");
    expect(items[2].title).toContain("Address ops issues");
  });

  it("keeps all-accept behavior when no equals selector is provided", async () => {
    await cmdRecommend(tmpDir, { accept: "true" });

    const items = await readPrdItems(tmpDir);
    expect(items).toHaveLength(3);
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
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("Address perf issues");
  });

  // ── Wildcard / =all syntax ──────────────────────────────────────────

  it("accepts all recommendations with =all selector", async () => {
    await cmdRecommend(tmpDir, { accept: "=all" });

    const items = await readPrdItems(tmpDir);
    expect(items).toHaveLength(3);
    expect(items[0].title).toContain("Address auth issues");
    expect(items[1].title).toContain("Address perf issues");
    expect(items[2].title).toContain("Address security issues");
  });

  it("=all and --accept=true produce equivalent results", async () => {
    // Accept with =all
    await cmdRecommend(tmpDir, { accept: "=all" });
    const itemsAll = await readPrdItems(tmpDir);

    // Reset PRD
    await writeFile(
      join(tmpDir, ".rex", "prd.json"),
      JSON.stringify({ schema: "rex/v1", title: "test-project", items: [] }),
      "utf-8",
    );

    // Accept with true (legacy)
    await cmdRecommend(tmpDir, { accept: "true" });
    const itemsTrue = await readPrdItems(tmpDir);

    expect(itemsAll.length).toBe(itemsTrue.length);
    for (let i = 0; i < itemsAll.length; i++) {
      expect(itemsAll[i].title).toBe(itemsTrue[i].title);
      expect(itemsAll[i].level).toBe(itemsTrue[i].level);
      expect(itemsAll[i].priority).toBe(itemsTrue[i].priority);
    }
  });

  // ── Single-recommendation scenarios ─────────────────────────────────

  it("works with a single recommendation (total=1, select=1)", async () => {
    await writeFindings(tmpDir, [
      { severity: "critical", category: "auth", message: "Auth finding" },
    ]);

    await cmdRecommend(tmpDir, { accept: "=1" });

    const items = await readPrdItems(tmpDir);
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain("Address auth issues");
  });

  // ── Selecting all indices explicitly ────────────────────────────────

  it("accepts all when every index is explicitly listed", async () => {
    await cmdRecommend(tmpDir, { accept: "=1,2,3" });

    const items = await readPrdItems(tmpDir);
    expect(items).toHaveLength(3);
  });

  // ── Metadata preservation through CLI accept flow ───────────────────

  it("preserves recommendation metadata through the accept pipeline", async () => {
    await writeFindings(tmpDir, [
      { severity: "critical", category: "auth", message: "Critical auth" },
      { severity: "warning", category: "auth", message: "Warning auth" },
    ]);

    await cmdRecommend(tmpDir, { accept: "=1" });

    const items = await readPrdItems(tmpDir);
    expect(items).toHaveLength(1);
    const meta = items[0].recommendationMeta as Record<string, unknown>;
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
    expect(items[0].priority).toBe("critical");
  });

  it("sets priority to high when all findings in a group are warnings", async () => {
    await writeFindings(tmpDir, [
      { severity: "warning", category: "perf", message: "Warning perf A" },
      { severity: "warning", category: "perf", message: "Warning perf B" },
    ]);

    await cmdRecommend(tmpDir, { accept: "=1" });

    const items = await readPrdItems(tmpDir);
    expect(items[0].priority).toBe("high");
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
  });
});
