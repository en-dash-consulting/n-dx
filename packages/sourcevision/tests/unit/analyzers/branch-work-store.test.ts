import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  saveBranchWorkRecord,
  loadBranchWorkRecord,
  branchWorkRecordPath,
  sanitizeBranchName,
} from "../../../src/analyzers/branch-work-store.js";
import { BranchWorkRecordSchema } from "../../../src/schema/validate.js";
import type { BranchWorkRecord, BranchWorkRecordItem } from "../../../src/schema/v1.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecordItem(overrides: Partial<BranchWorkRecordItem> = {}): BranchWorkRecordItem {
  return {
    id: overrides.id ?? "task-1",
    title: overrides.title ?? "Test task",
    level: overrides.level ?? "task",
    completedAt: overrides.completedAt ?? "2026-02-24T10:00:00.000Z",
    parentChain: overrides.parentChain ?? [],
    ...overrides,
  };
}

function makeRecord(overrides: Partial<BranchWorkRecord> = {}): BranchWorkRecord {
  return {
    schemaVersion: "1.0.0",
    branch: overrides.branch ?? "feature/test-branch",
    baseBranch: overrides.baseBranch ?? "main",
    createdAt: overrides.createdAt ?? "2026-02-24T12:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-02-24T12:00:00.000Z",
    items: overrides.items ?? [makeRecordItem()],
    epicSummaries: overrides.epicSummaries ?? [],
    metadata: overrides.metadata ?? {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("branch-work-store", () => {
  let tmpDir: string;
  let svDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-bws-"));
    svDir = join(tmpDir, ".sourcevision");
    await mkdir(svDir, { recursive: true });
  });

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  // ── sanitizeBranchName ──────────────────────────────────────────

  describe("sanitizeBranchName", () => {
    it("replaces slashes with dashes", () => {
      expect(sanitizeBranchName("feature/add-auth")).toBe("feature-add-auth");
    });

    it("replaces multiple special characters", () => {
      expect(sanitizeBranchName("feature/my_branch@v2")).toBe("feature-my_branch-v2");
    });

    it("leaves simple branch names unchanged", () => {
      expect(sanitizeBranchName("main")).toBe("main");
    });

    it("handles dots in branch names", () => {
      expect(sanitizeBranchName("release/v1.2.3")).toBe("release-v1.2.3");
    });

    it("collapses consecutive dashes", () => {
      expect(sanitizeBranchName("feature//double")).toBe("feature-double");
    });

    it("trims leading and trailing dashes", () => {
      expect(sanitizeBranchName("/leading/")).toBe("leading");
    });
  });

  // ── branchWorkRecordPath ────────────────────────────────────────

  describe("branchWorkRecordPath", () => {
    it("returns path under .sourcevision/ with branch-specific name", () => {
      const p = branchWorkRecordPath(tmpDir, "feature/my-branch");
      expect(p).toBe(join(svDir, "branch-work-feature-my-branch.json"));
    });

    it("sanitizes branch names with special characters", () => {
      const p = branchWorkRecordPath(tmpDir, "release/v2.0@rc1");
      expect(p).toBe(join(svDir, "branch-work-release-v2.0-rc1.json"));
    });
  });

  // ── BranchWorkRecordSchema (Zod validation) ─────────────────────

  describe("BranchWorkRecordSchema", () => {
    it("validates a well-formed record", () => {
      const record = makeRecord();
      const result = BranchWorkRecordSchema.safeParse(record);
      expect(result.success).toBe(true);
    });

    it("rejects record without schemaVersion", () => {
      const record = makeRecord();
      const { schemaVersion: _, ...noVersion } = record;
      const result = BranchWorkRecordSchema.safeParse(noVersion);
      expect(result.success).toBe(false);
    });

    it("rejects record without branch", () => {
      const record = makeRecord();
      const { branch: _, ...noBranch } = record;
      const result = BranchWorkRecordSchema.safeParse(noBranch);
      expect(result.success).toBe(false);
    });

    it("rejects record without items array", () => {
      const record = makeRecord();
      const { items: _, ...noItems } = record;
      const result = BranchWorkRecordSchema.safeParse(noItems);
      expect(result.success).toBe(false);
    });

    it("validates items with all required fields", () => {
      const record = makeRecord({
        items: [
          makeRecordItem({
            id: "task-1",
            title: "Auth task",
            level: "task",
            completedAt: "2026-02-24T10:00:00.000Z",
            parentChain: [
              { id: "epic-1", title: "Auth Epic", level: "epic" },
            ],
          }),
        ],
      });
      const result = BranchWorkRecordSchema.safeParse(record);
      expect(result.success).toBe(true);
    });

    it("validates item with optional metadata fields", () => {
      const record = makeRecord({
        items: [
          makeRecordItem({
            priority: "high",
            tags: ["backend", "auth"],
            description: "Implement login flow",
            acceptanceCriteria: ["Tests pass", "Login works"],
            changeSignificance: "major",
            breakingChange: true,
          }),
        ],
      });
      const result = BranchWorkRecordSchema.safeParse(record);
      expect(result.success).toBe(true);
    });

    it("validates record-level metadata", () => {
      const record = makeRecord({
        metadata: {
          totalCompletedCount: 5,
          gitSha: "abc123",
        },
      });
      const result = BranchWorkRecordSchema.safeParse(record);
      expect(result.success).toBe(true);
    });

    it("rejects invalid changeSignificance value", () => {
      const record = makeRecord({
        items: [
          makeRecordItem({
            changeSignificance: "enormous" as any,
          }),
        ],
      });
      const result = BranchWorkRecordSchema.safeParse(record);
      expect(result.success).toBe(false);
    });

    it("validates epicSummaries field", () => {
      const record = makeRecord({
        epicSummaries: [
          { id: "epic-1", title: "Auth System", completedCount: 3 },
        ],
      });
      const result = BranchWorkRecordSchema.safeParse(record);
      expect(result.success).toBe(true);
    });
  });

  // ── saveBranchWorkRecord ────────────────────────────────────────

  describe("saveBranchWorkRecord", () => {
    it("writes a valid record to disk", async () => {
      const record = makeRecord();
      await saveBranchWorkRecord(tmpDir, record);

      const expectedPath = branchWorkRecordPath(tmpDir, record.branch);
      expect(existsSync(expectedPath)).toBe(true);

      const raw = await readFile(expectedPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.schemaVersion).toBe("1.0.0");
      expect(parsed.branch).toBe("feature/test-branch");
      expect(parsed.items).toHaveLength(1);
    });

    it("creates .sourcevision directory if it does not exist", async () => {
      const freshDir = await mkdtemp(join(tmpdir(), "sv-bws-fresh-"));
      try {
        const record = makeRecord();
        await saveBranchWorkRecord(freshDir, record);

        const expectedPath = branchWorkRecordPath(freshDir, record.branch);
        expect(existsSync(expectedPath)).toBe(true);
      } finally {
        await rm(freshDir, { recursive: true, force: true });
      }
    });

    it("updates the updatedAt timestamp on save", async () => {
      const record = makeRecord({
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
      await saveBranchWorkRecord(tmpDir, record);

      const expectedPath = branchWorkRecordPath(tmpDir, record.branch);
      const raw = await readFile(expectedPath, "utf-8");
      const parsed = JSON.parse(raw);
      // updatedAt should be newer than the original value
      expect(parsed.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
    });

    it("rejects invalid records (schema validation)", async () => {
      const badRecord = { branch: "test" } as any;
      await expect(saveBranchWorkRecord(tmpDir, badRecord)).rejects.toThrow();
    });

    it("writes pretty-printed JSON", async () => {
      const record = makeRecord();
      await saveBranchWorkRecord(tmpDir, record);

      const expectedPath = branchWorkRecordPath(tmpDir, record.branch);
      const raw = await readFile(expectedPath, "utf-8");
      // Pretty-printed JSON has newlines
      expect(raw).toContain("\n");
      // Should end with newline
      expect(raw.endsWith("\n")).toBe(true);
    });
  });

  // ── loadBranchWorkRecord ────────────────────────────────────────

  describe("loadBranchWorkRecord", () => {
    it("loads a previously saved record", async () => {
      const record = makeRecord();
      await saveBranchWorkRecord(tmpDir, record);

      const loaded = await loadBranchWorkRecord(tmpDir, record.branch);
      expect(loaded).not.toBeNull();
      expect(loaded!.branch).toBe("feature/test-branch");
      expect(loaded!.items).toHaveLength(1);
      expect(loaded!.items[0].id).toBe("task-1");
    });

    it("returns null when no record exists for branch", async () => {
      const loaded = await loadBranchWorkRecord(tmpDir, "feature/nonexistent");
      expect(loaded).toBeNull();
    });

    it("returns null for corrupted file", async () => {
      const filePath = branchWorkRecordPath(tmpDir, "feature/bad");
      await writeFile(filePath, "{{{not valid json");

      const loaded = await loadBranchWorkRecord(tmpDir, "feature/bad");
      expect(loaded).toBeNull();
    });

    it("returns null for file that fails schema validation", async () => {
      const filePath = branchWorkRecordPath(tmpDir, "feature/invalid");
      await writeFile(filePath, JSON.stringify({ wrong: "shape" }));

      const loaded = await loadBranchWorkRecord(tmpDir, "feature/invalid");
      expect(loaded).toBeNull();
    });

    it("preserves all fields through save/load round trip", async () => {
      const record = makeRecord({
        items: [
          makeRecordItem({
            id: "task-1",
            title: "Auth task",
            level: "task",
            completedAt: "2026-02-24T10:00:00.000Z",
            priority: "high",
            tags: ["backend"],
            description: "Implement auth",
            acceptanceCriteria: ["Tests pass"],
            changeSignificance: "major",
            breakingChange: true,
            parentChain: [
              { id: "epic-1", title: "Auth Epic", level: "epic" },
              { id: "feat-1", title: "Auth Feature", level: "feature" },
            ],
          }),
        ],
        epicSummaries: [
          { id: "epic-1", title: "Auth Epic", completedCount: 1 },
        ],
        metadata: {
          totalCompletedCount: 1,
          gitSha: "abc123def",
        },
      });

      await saveBranchWorkRecord(tmpDir, record);
      const loaded = await loadBranchWorkRecord(tmpDir, record.branch);

      expect(loaded).not.toBeNull();
      expect(loaded!.items[0].id).toBe("task-1");
      expect(loaded!.items[0].priority).toBe("high");
      expect(loaded!.items[0].tags).toEqual(["backend"]);
      expect(loaded!.items[0].changeSignificance).toBe("major");
      expect(loaded!.items[0].breakingChange).toBe(true);
      expect(loaded!.items[0].parentChain).toHaveLength(2);
      expect(loaded!.epicSummaries).toHaveLength(1);
      expect(loaded!.metadata?.totalCompletedCount).toBe(1);
      expect(loaded!.metadata?.gitSha).toBe("abc123def");
    });
  });
});
