import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readPRD } from "../helpers/rex-dir-test-support.js";

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
    timeout: 15000,
  });
}

describe("rex import (alias for analyze)", { timeout: 120_000 }, () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-import-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("works as alias for analyze with scanner mode", async () => {
    await mkdir(join(tmpDir, "tests"), { recursive: true });
    await writeFile(
      join(tmpDir, "tests", "auth.test.ts"),
      `
describe("Auth", () => {
  it("validates tokens", () => {});
});
`,
    );

    const output = run(["import", "--no-llm", tmpDir]);

    expect(output).toContain("Scanned:");
    expect(output).toContain("test files");
    expect(output).toContain("proposals");
  });

  it("supports --file flag like analyze", async () => {
    const content = JSON.stringify([
      {
        epic: { title: "Auth" },
        features: [
          { title: "Login", tasks: [{ title: "Validate email" }] },
        ],
      },
    ]);
    await writeFile(join(tmpDir, "spec.json"), content);

    const output = run(["import", "--file=spec.json", "--format=json", tmpDir]);
    const parsed = JSON.parse(output);

    expect(parsed).toHaveProperty("proposals");
    expect(parsed.proposals).toHaveLength(1);
    expect(parsed.proposals[0].epic.title).toBe("Auth");
  });

  it("supports --accept like analyze", async () => {
    run(["init", tmpDir]);

    await mkdir(join(tmpDir, "tests"), { recursive: true });
    await writeFile(
      join(tmpDir, "tests", "billing.test.ts"),
      `
describe("Billing", () => {
  it("processes payments", () => {});
});
`,
    );

    const output = run(["import", "--no-llm", "--accept", tmpDir]);
    expect(output).toContain("Accepted");
    expect(output).toContain("items added to PRD");

    const prd = readPRD(tmpDir);
    expect(prd.items.length).toBeGreaterThan(0);
  });

  it("produces same --format=json output as analyze", async () => {
    await mkdir(join(tmpDir, "tests"), { recursive: true });
    await writeFile(
      join(tmpDir, "tests", "app.test.ts"),
      `
describe("App", () => {
  it("renders", () => {});
});
`,
    );

    const analyzeOutput = run(["analyze", "--no-llm", "--format=json", tmpDir]);
    const importOutput = run(["import", "--no-llm", "--format=json", tmpDir]);

    const analyzeParsed = JSON.parse(analyzeOutput);
    const importParsed = JSON.parse(importOutput);

    expect(importParsed.scanned).toEqual(analyzeParsed.scanned);
    expect(importParsed.stats).toEqual(analyzeParsed.stats);
    expect(importParsed.proposals.length).toBe(analyzeParsed.proposals.length);
  });

  it("shows in help text", () => {
    const output = run(["--help"]);
    expect(output).toContain("import");
    expect(output).toContain("Alias for analyze");
  });
});
