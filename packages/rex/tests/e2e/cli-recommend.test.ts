import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

function runFail(args: string[]): string {
  try {
    run(args);
    throw new Error("Expected command to fail");
  } catch (err) {
    if (!(err instanceof Error) || !("stdout" in err)) {
      throw err;
    }
    const stdout = String((err as Error & { stdout?: string }).stdout ?? "");
    const stderr = String((err as Error & { stderr?: string }).stderr ?? "");
    return `${stdout}${stderr}`;
  }
}

describe("rex recommend", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-recommend-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("accepts only selected recommendation indices", async () => {
    run(["init", tmpDir]);
    await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tmpDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        findings: [
          { severity: "warning", category: "auth", message: "Auth finding" },
          { severity: "warning", category: "perf", message: "Perf finding" },
          { severity: "warning", category: "security", message: "Security finding" },
          { severity: "warning", category: "docs", message: "Docs finding" },
          { severity: "warning", category: "ops", message: "Ops finding" },
        ],
      }),
      "utf-8",
    );

    const output = run(["recommend", "--accept==1,4,5", tmpDir]);
    // Check the creation result section (after "Creating N of M")
    const creationSection = output.slice(output.indexOf("Creating 3 of 5"));
    expect(creationSection).toContain("Fix auth in global");
    expect(creationSection).toContain("Fix docs in global");
    expect(creationSection).toContain("Fix ops in global");
    expect(creationSection).not.toContain("Fix perf in global");
    expect(creationSection).not.toContain("Fix security in global");
    expect(output).toContain("3/3 selected recommendation");

    // Hierarchical structure: epic at root → features → tasks
    const prd = JSON.parse(await readFile(join(tmpDir, ".rex", "prd.json"), "utf-8"));
    expect(prd.items).toHaveLength(1); // 1 epic at root
    expect(prd.items[0].level).toBe("epic");

    // Collect all task titles from the hierarchy
    type Item = { title: string; level: string; children?: Item[] };
    const collectTasks = (items: Item[]): string[] => {
      const result: string[] = [];
      for (const item of items) {
        if (item.level === "task") result.push(item.title);
        if (item.children) result.push(...collectTasks(item.children));
      }
      return result;
    };
    const taskTitles = collectTasks(prd.items);
    expect(taskTitles).toEqual([
      "Fix auth in global: Auth finding",
      "Fix docs in global: Docs finding",
      "Fix ops in global: Ops finding",
    ]);
  });

  it("returns a format error when selector value is missing '='", async () => {
    run(["init", tmpDir]);
    await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tmpDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        findings: [
          { severity: "warning", category: "auth", message: "Auth finding" },
        ],
      }),
      "utf-8",
    );

    const output = runFail(["recommend", "--accept=1", tmpDir]);
    expect(output).toContain("Invalid --accept selector format");
    expect(output).toContain("Example: rex recommend --accept='=1,4,5' .");
  });

  it("returns a validation error when selector index is out of range", async () => {
    run(["init", tmpDir]);
    await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });
    await writeFile(
      join(tmpDir, ".sourcevision", "zones.json"),
      JSON.stringify({
        findings: [
          { severity: "warning", category: "auth", message: "Auth finding" },
          { severity: "warning", category: "perf", message: "Perf finding" },
        ],
      }),
      "utf-8",
    );

    const output = runFail(["recommend", "--accept==9", tmpDir]);
    expect(output).toContain("Invalid --accept selector index 9");
    expect(output).toContain("between 1 and 2");
  });
});
