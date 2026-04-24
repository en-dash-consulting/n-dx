import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseDocument } from "../../src/store/markdown-parser.js";
import { SCHEMA_VERSION, type PRDDocument } from "../../src/schema/index.js";
import { toCanonicalJSON } from "../../src/core/canonical.js";

const cliPath = join(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "dist",
  "cli",
  "index.js",
);

function run(args: string[]): string {
  return execFileSync("node", [cliPath, ...args], {
    encoding: "utf-8",
    timeout: 10000,
  });
}

describe("rex migrate-to-md", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-migrate-md-"));
    rexDir = join(tmpDir, ".rex");
    await mkdir(rexDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates prd.md from prd.json and leaves prd.json untouched", async () => {
    const doc: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "CLI migration",
      items: [
        {
          id: "task-1",
          title: "Task",
          level: "task",
          status: "in_progress",
          startedAt: "2026-01-01T00:00:00.000Z",
          duration: { totalMs: 1000, runningMs: 1000 },
          tokenUsage: { input: 50, output: 25 },
          activeIntervals: [{ start: "2026-01-01T00:00:00.000Z" }],
        },
      ],
    };
    const jsonPath = join(rexDir, "prd.json");
    const jsonBefore = toCanonicalJSON(doc);
    await writeFile(jsonPath, jsonBefore, "utf-8");

    const output = run(["migrate-to-md", tmpDir]);
    expect(output).toContain(join(rexDir, "prd.md"));

    const markdownPath = join(rexDir, "prd.md");
    await access(markdownPath);
    const markdown = await readFile(markdownPath, "utf-8");
    const parsed = parseDocument(markdown);
    if (!parsed.ok) throw parsed.error;
    expect(parsed.data).toEqual(doc);

    const jsonAfter = await readFile(jsonPath, "utf-8");
    expect(jsonAfter).toBe(jsonBefore);
  });
});
