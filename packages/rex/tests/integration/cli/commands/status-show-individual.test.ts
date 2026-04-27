/**
 * Integration tests: `rex status --show-individual` per-PRD breakdown.
 *
 * Verifies that the flag groups items by their owning PRD file and renders
 * one labeled section per file in both the human-readable tree output and
 * the JSON output.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdStatus } from "../../../../src/cli/commands/status.js";
import type { PRDDocument } from "../../../../src/schema/index.js";

function writePRDFile(rexDir: string, filename: string, doc: PRDDocument): void {
  writeFileSync(join(rexDir, filename), JSON.stringify(doc));
}

const SINGLE_PRD: PRDDocument = {
  schema: "rex/v1",
  title: "Single Project",
  items: [
    {
      id: "e1",
      title: "Auth",
      level: "epic",
      status: "in_progress",
      children: [
        { id: "t1", title: "Login", level: "task", status: "completed" },
        { id: "t2", title: "Logout", level: "task", status: "pending" },
      ],
    },
  ],
};

const BASE_PRD: PRDDocument = {
  schema: "rex/v1",
  title: "Multi Project",
  items: [
    {
      id: "e1",
      title: "Core Epic",
      level: "epic",
      status: "in_progress",
      children: [
        { id: "t1", title: "Core Task A", level: "task", status: "completed" },
        { id: "t2", title: "Core Task B", level: "task", status: "pending" },
      ],
    },
  ],
};

const BRANCH_PRD: PRDDocument = {
  schema: "rex/v1",
  title: "Branch Project",
  items: [
    {
      id: "eb1",
      title: "Branch Epic",
      level: "epic",
      status: "pending",
      children: [
        { id: "tb1", title: "Branch Task", level: "task", status: "pending" },
      ],
    },
  ],
};

describe("rex status --show-individual", () => {
  let tmp: string;
  let rexDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-status-show-individual-"));
    rexDir = join(tmp, ".rex");
    mkdirSync(rexDir);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    rmSync(tmp, { recursive: true });
  });

  function output(): string {
    return logSpy.mock.calls.map((c) => c[0] ?? "").join("\n");
  }

  describe("single PRD file (canonical .rex/prd.md)", () => {
    it("produces a single section labeled with .rex/prd.md", async () => {
      writePRDFile(rexDir, "prd.json", SINGLE_PRD);

      await cmdStatus(tmp, { "show-individual": "true", tokens: "false" });
      const out = output();

      expect(out).toContain(".rex/prd.md");
      expect(out).toContain("Auth");
      expect(out).toContain("Logout");
    });

    it("emits a one-element JSON array with prdPath, stats, items", async () => {
      writePRDFile(rexDir, "prd.json", SINGLE_PRD);

      await cmdStatus(tmp, {
        "show-individual": "true",
        format: "json",
        tokens: "false",
      });

      const parsed = JSON.parse(output());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);

      const section = parsed[0];
      expect(section.prdPath).toBe(".rex/prd.md");
      expect(section.stats).toBeDefined();
      expect(section.stats.total).toBe(2);
      expect(section.stats.completed).toBe(1);
      expect(section.stats.pending).toBe(1);
      expect(section.items).toHaveLength(1);
      expect(section.items[0].id).toBe("e1");
    });

    it("works with an empty PRD without throwing", async () => {
      writePRDFile(rexDir, "prd.json", {
        schema: "rex/v1",
        title: "Empty",
        items: [],
      });

      await cmdStatus(tmp, {
        "show-individual": "true",
        format: "json",
        tokens: "false",
      });

      const parsed = JSON.parse(output());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].prdPath).toBe(".rex/prd.md");
      expect(parsed[0].items).toHaveLength(0);
      expect(parsed[0].stats.total).toBe(0);
    });
  });

  describe("multi PRD files (canonical + branch-scoped)", () => {
    it("produces one section per PRD file with disjoint items", async () => {
      writePRDFile(rexDir, "prd.json", BASE_PRD);
      writePRDFile(rexDir, "prd_feature-x_2026-04-26.json", BRANCH_PRD);

      await cmdStatus(tmp, { "show-individual": "true", tokens: "false" });
      const out = output();

      expect(out).toContain(".rex/prd.md");
      expect(out).toContain(".rex/prd_feature-x_2026-04-26.md");
      expect(out).toContain("Core Epic");
      expect(out).toContain("Branch Epic");

      // Each section contains only its own items
      const splitIdx = out.indexOf(".rex/prd_feature-x_2026-04-26.md");
      expect(splitIdx).toBeGreaterThan(0);
      const baseSection = out.slice(0, splitIdx);
      const branchSection = out.slice(splitIdx);

      expect(baseSection).toContain("Core Epic");
      expect(baseSection).not.toContain("Branch Epic");
      expect(branchSection).toContain("Branch Epic");
      expect(branchSection).not.toContain("Core Epic");
    });

    it("emits an array with one element per PRD file in JSON mode", async () => {
      writePRDFile(rexDir, "prd.json", BASE_PRD);
      writePRDFile(rexDir, "prd_feature-x_2026-04-26.json", BRANCH_PRD);

      await cmdStatus(tmp, {
        "show-individual": "true",
        format: "json",
        all: "true",
        tokens: "false",
      });

      const parsed = JSON.parse(output());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);

      const paths = parsed.map((s: { prdPath: string }) => s.prdPath).sort();
      expect(paths).toEqual([
        ".rex/prd.md",
        ".rex/prd_feature-x_2026-04-26.md",
      ].sort());

      const base = parsed.find(
        (s: { prdPath: string }) => s.prdPath === ".rex/prd.md",
      );
      const branch = parsed.find(
        (s: { prdPath: string }) =>
          s.prdPath === ".rex/prd_feature-x_2026-04-26.md",
      );

      expect(base.items).toHaveLength(1);
      expect(base.items[0].id).toBe("e1");
      expect(base.stats.total).toBe(2);
      expect(base.stats.completed).toBe(1);

      expect(branch.items).toHaveLength(1);
      expect(branch.items[0].id).toBe("eb1");
      expect(branch.stats.total).toBe(1);
      expect(branch.stats.pending).toBe(1);
    });

    it("includes per-section completion stats in the human-readable output", async () => {
      writePRDFile(rexDir, "prd.json", BASE_PRD);
      writePRDFile(rexDir, "prd_feature-x_2026-04-26.json", BRANCH_PRD);

      await cmdStatus(tmp, { "show-individual": "true", tokens: "false" });
      const out = output();

      // Each section should have a stats line showing X/Y complete
      const matches = out.match(/\d+\/\d+/g) ?? [];
      // At minimum, two stats lines (one per section), plus child counts
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it("does not duplicate items across sections", async () => {
      writePRDFile(rexDir, "prd.json", BASE_PRD);
      writePRDFile(rexDir, "prd_feature-x_2026-04-26.json", BRANCH_PRD);

      await cmdStatus(tmp, {
        "show-individual": "true",
        format: "json",
        all: "true",
        tokens: "false",
      });

      const parsed = JSON.parse(output());
      const allIds: string[] = [];
      for (const section of parsed) {
        const collect = (
          items: Array<{ id: string; children?: Array<unknown> }>,
        ): void => {
          for (const item of items) {
            allIds.push(item.id);
            if (item.children) {
              collect(
                item.children as Array<{ id: string; children?: Array<unknown> }>,
              );
            }
          }
        };
        collect(section.items);
      }
      const unique = new Set(allIds);
      expect(unique.size).toBe(allIds.length);
    });
  });
});
