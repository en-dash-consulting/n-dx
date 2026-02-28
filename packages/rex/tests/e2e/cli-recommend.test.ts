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
    expect(creationSection).toContain("Address auth issues");
    expect(creationSection).toContain("Address docs issues");
    expect(creationSection).toContain("Address ops issues");
    expect(creationSection).not.toContain("Address perf issues");
    expect(creationSection).not.toContain("Address security issues");
    expect(output).toContain("3/3 selected recommendation");

    const prd = JSON.parse(await readFile(join(tmpDir, ".rex", "prd.json"), "utf-8"));
    const titles = prd.items.map((item: { title: string }) => item.title);
    expect(titles).toEqual([
      "Address auth issues (1 findings)",
      "Address docs issues (1 findings)",
      "Address ops issues (1 findings)",
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
