import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  RexConfigSchema,
  PRDDocumentSchema,
} from "../../src/schema/validate.js";
import { SCHEMA_VERSION, DEFAULT_CONFIG } from "../../src/schema/v1.js";
import { parseDocument } from "../../src/store/markdown-parser.js";

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

describe("rex init", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-init-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates .rex/ with all files", async () => {
    const output = run(["init", tmpDir]);
    expect(output).toContain("Initialized .rex/");

    const rexDir = join(tmpDir, ".rex");
    await access(join(rexDir, "config.json"));
    await access(join(rexDir, "prd.json"));
    await access(join(rexDir, "prd.md"));
    await access(join(rexDir, "execution-log.jsonl"));
    await access(join(rexDir, "workflow.md"));
  });

  it("creates valid config.json", async () => {
    run(["init", tmpDir]);
    const config = JSON.parse(
      await readFile(join(tmpDir, ".rex", "config.json"), "utf-8"),
    );
    expect(config.schema).toBe("rex/v1");
    expect(config.adapter).toBe("file");
    expect(typeof config.project).toBe("string");
  });

  it("creates config.json that passes schema validation", async () => {
    run(["init", tmpDir]);
    const config = JSON.parse(
      await readFile(join(tmpDir, ".rex", "config.json"), "utf-8"),
    );
    const result = RexConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`Schema validation failed: ${result.error.message}`);
    }
  });

  it("creates config.json matching DEFAULT_CONFIG", async () => {
    run(["init", tmpDir]);
    const config = JSON.parse(
      await readFile(join(tmpDir, ".rex", "config.json"), "utf-8"),
    );
    const defaults = DEFAULT_CONFIG(basename(tmpDir));

    expect(config).toEqual(defaults);
  });

  it("creates config.json with correct schema version", async () => {
    run(["init", tmpDir]);
    const config = JSON.parse(
      await readFile(join(tmpDir, ".rex", "config.json"), "utf-8"),
    );

    expect(config.schema).toBe(SCHEMA_VERSION);
  });

  it("uses --project flag for project name", async () => {
    run(["init", tmpDir, "--project=my-custom-project"]);
    const config = JSON.parse(
      await readFile(join(tmpDir, ".rex", "config.json"), "utf-8"),
    );

    expect(config.project).toBe("my-custom-project");

    const doc = JSON.parse(
      await readFile(join(tmpDir, ".rex", "prd.json"), "utf-8"),
    );
    expect(doc.title).toBe("my-custom-project");
  });

  it("defaults project name to directory basename", async () => {
    run(["init", tmpDir]);
    const config = JSON.parse(
      await readFile(join(tmpDir, ".rex", "config.json"), "utf-8"),
    );

    expect(config.project).toBe(basename(tmpDir));
  });

  it("creates valid prd.json", async () => {
    run(["init", tmpDir]);
    const doc = JSON.parse(
      await readFile(join(tmpDir, ".rex", "prd.json"), "utf-8"),
    );
    expect(doc.schema).toBe("rex/v1");
    expect(doc.items).toEqual([]);
  });

  it("creates prd.md in sync with prd.json", async () => {
    run(["init", tmpDir]);
    const jsonDoc = JSON.parse(
      await readFile(join(tmpDir, ".rex", "prd.json"), "utf-8"),
    );
    const markdown = await readFile(join(tmpDir, ".rex", "prd.md"), "utf-8");
    const parsed = parseDocument(markdown);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw parsed.error;
    }
    expect(parsed.data).toEqual(jsonDoc);
  });

  it("creates prd.json that passes schema validation", async () => {
    run(["init", tmpDir]);
    const doc = JSON.parse(
      await readFile(join(tmpDir, ".rex", "prd.json"), "utf-8"),
    );
    const result = PRDDocumentSchema.safeParse(doc);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(`Schema validation failed: ${result.error.message}`);
    }
  });

  it("creates prd.json with correct schema version", async () => {
    run(["init", tmpDir]);
    const doc = JSON.parse(
      await readFile(join(tmpDir, ".rex", "prd.json"), "utf-8"),
    );

    expect(doc.schema).toBe(SCHEMA_VERSION);
  });

  it("creates prd.json with title matching project name", async () => {
    run(["init", tmpDir]);
    const config = JSON.parse(
      await readFile(join(tmpDir, ".rex", "config.json"), "utf-8"),
    );
    const doc = JSON.parse(
      await readFile(join(tmpDir, ".rex", "prd.json"), "utf-8"),
    );

    expect(doc.title).toBe(config.project);
  });

  it("creates empty execution-log.jsonl", async () => {
    run(["init", tmpDir]);
    const log = await readFile(
      join(tmpDir, ".rex", "execution-log.jsonl"),
      "utf-8",
    );
    expect(log).toBe("");
  });

  it("creates n-dx_workflow.md with base workflow and workflow.md as template", async () => {
    run(["init", tmpDir]);
    const base = await readFile(
      join(tmpDir, ".rex", "n-dx_workflow.md"),
      "utf-8",
    );
    expect(base).toContain("get_next_task");
    expect(base).toContain("PROHIBITED CHANGES");

    const user = await readFile(
      join(tmpDir, ".rex", "workflow.md"),
      "utf-8",
    );
    expect(user).toContain("Project Workflow Customizations");
  });

  it("is idempotent on re-run", async () => {
    run(["init", tmpDir]);
    const output = run(["init", tmpDir]);
    expect(output).toContain("already exists");

    // Files should still be valid
    const doc = JSON.parse(
      await readFile(join(tmpDir, ".rex", "prd.json"), "utf-8"),
    );
    expect(doc.schema).toBe("rex/v1");
  });

  it("preserves valid files on re-run", async () => {
    run(["init", tmpDir]);

    const rexDir = join(tmpDir, ".rex");
    const configRaw1 = await readFile(join(rexDir, "config.json"), "utf-8");
    const prdRaw1 = await readFile(join(rexDir, "prd.json"), "utf-8");

    run(["init", tmpDir]);

    const configRaw2 = await readFile(join(rexDir, "config.json"), "utf-8");
    const prdRaw2 = await readFile(join(rexDir, "prd.json"), "utf-8");

    // Files unchanged
    expect(configRaw2).toBe(configRaw1);
    expect(prdRaw2).toBe(prdRaw1);

    // Both still pass schema validation
    const configResult = RexConfigSchema.safeParse(JSON.parse(configRaw2));
    expect(configResult.success).toBe(true);

    const docResult = PRDDocumentSchema.safeParse(JSON.parse(prdRaw2));
    expect(docResult.success).toBe(true);
  });
});
