import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import { SCHEMA_VERSION, type PRDDocument } from "../../../src/schema/index.js";
import {
  migrateJsonPrdToMarkdown,
  PRD_MARKDOWN_FILENAME,
} from "../../../src/store/prd-md-migration.js";
import { parseDocument } from "../../../src/store/markdown-parser.js";

describe("migrateJsonPrdToMarkdown", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-md-migration-"));
    rexDir = join(tmpDir, ".rex");
    await mkdir(rexDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates prd.md from prd.json without modifying the original JSON", async () => {
    const doc: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Migration Fixture",
      items: [
        {
          id: "epic-1",
          title: "Completed epic",
          level: "epic",
          status: "completed",
          priority: "high",
          startedAt: "2026-01-01T09:00:00.000Z",
          completedAt: "2026-01-03T18:00:00.000Z",
          endedAt: "2026-01-03T18:00:00.000Z",
          activeIntervals: [
            { start: "2026-01-01T09:00:00.000Z", end: "2026-01-01T17:00:00.000Z" },
          ],
          duration: { totalMs: 28800000, runningMs: 0 },
          tokenUsage: { input: 1440, output: 320, cacheCreationInput: 25, cacheReadInput: 10 },
          resolutionType: "code-change",
          resolutionDetail: "Implemented markdown migration.",
          acceptanceCriteria: ["Round-trip passes"],
          children: [
            {
              id: "task-1",
              title: "In-progress task",
              level: "task",
              status: "in_progress",
              startedAt: "2026-01-04T09:00:00.000Z",
              activeIntervals: [{ start: "2026-01-04T09:00:00.000Z" }],
              tokenUsage: { input: 80, output: 20 },
            },
          ],
        },
      ],
    };

    const jsonPath = join(rexDir, "prd.json");
    const jsonBefore = toCanonicalJSON(doc);
    await writeFile(jsonPath, jsonBefore, "utf-8");

    const result = await migrateJsonPrdToMarkdown(rexDir);
    expect(result.migrated).toBe(true);
    expect(result.outputPath).toBe(join(rexDir, PRD_MARKDOWN_FILENAME));

    const jsonAfter = await readFile(jsonPath, "utf-8");
    expect(jsonAfter).toBe(jsonBefore);

    const markdown = await readFile(result.outputPath, "utf-8");
    const parsed = parseDocument(markdown);
    if (!parsed.ok) throw parsed.error;
    expect(parsed.data).toEqual(doc);
  });

  it("returns markdown-exists when prd.md is already present", async () => {
    await writeFile(
      join(rexDir, "prd.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, title: "Project", items: [] }),
      "utf-8",
    );
    await writeFile(join(rexDir, PRD_MARKDOWN_FILENAME), "# Existing\n", "utf-8");

    const result = await migrateJsonPrdToMarkdown(rexDir);
    expect(result.migrated).toBe(false);
    expect(result.reason).toBe("markdown-exists");
  });
});
