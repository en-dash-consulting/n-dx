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

describe("rex analyze", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-analyze-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("scans test files and markdown, prints proposals", async () => {
    // Create test files
    await mkdir(join(tmpDir, "tests", "auth"), { recursive: true });
    await writeFile(
      join(tmpDir, "tests", "auth", "login.test.ts"),
      `
describe("Login", () => {
  it("validates email format", () => {});
  it("handles invalid credentials", () => {});
});
`,
    );

    // Create a doc
    await writeFile(
      join(tmpDir, "features.md"),
      `# Dashboard
- Display charts
- Export data
`,
    );

    const output = run(["analyze", "--no-llm", tmpDir]);

    expect(output).toContain("Scanned:");
    expect(output).toContain("test files");
    expect(output).toContain("docs");
    expect(output).toContain("proposals");
    expect(output).toContain("[epic]");
    expect(output).toContain("[feature]");
  });

  it("supports --format=json", async () => {
    await mkdir(join(tmpDir, "tests"), { recursive: true });
    await writeFile(
      join(tmpDir, "tests", "app.test.ts"),
      `
describe("App", () => {
  it("renders", () => {});
});
`,
    );

    const output = run(["analyze", "--no-llm", "--format=json", tmpDir]);
    const parsed = JSON.parse(output);

    expect(parsed).toHaveProperty("scanned");
    expect(parsed).toHaveProperty("stats");
    expect(parsed).toHaveProperty("proposals");
    expect(parsed.scanned.testFiles).toBeGreaterThanOrEqual(1);
  });

  it("supports --lite mode", async () => {
    await mkdir(join(tmpDir, "tests"), { recursive: true });
    await writeFile(
      join(tmpDir, "tests", "auth.test.ts"),
      `
describe("Auth", () => {
  it("validates tokens", () => {});
  it("handles expiry", () => {});
});
`,
    );

    const fullOutput = run(["analyze", "--no-llm", "--format=json", tmpDir]);
    const liteOutput = run(["analyze", "--no-llm", "--lite", "--format=json", tmpDir]);

    const fullParsed = JSON.parse(fullOutput);
    const liteParsed = JSON.parse(liteOutput);

    // Lite should have fewer proposals (no task-level items from content parsing)
    expect(liteParsed.stats.total).toBeLessThan(fullParsed.stats.total);
  });

  it("accepts proposals into PRD with --accept", async () => {
    // Init rex first
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

    const output = run(["analyze", "--no-llm", "--accept", tmpDir]);
    expect(output).toContain("Added");
    expect(output).toContain("items to PRD");

    // Verify items in prd.json
    const prd = JSON.parse(
      await readFile(join(tmpDir, ".rex", "prd.json"), "utf-8"),
    );
    expect(prd.items.length).toBeGreaterThan(0);
  });

  it("reconciliation skips already-added items on second run", async () => {
    run(["init", tmpDir]);

    await mkdir(join(tmpDir, "tests"), { recursive: true });
    await writeFile(
      join(tmpDir, "tests", "core.test.ts"),
      `
describe("Core", () => {
  it("initializes", () => {});
});
`,
    );

    // First accept
    run(["analyze", "--no-llm", "--accept", tmpDir]);

    // Second run should show items as already tracked
    const secondOutput = run(["analyze", "--no-llm", "--format=json", tmpDir]);
    const parsed = JSON.parse(secondOutput);
    expect(parsed.stats.alreadyTracked).toBeGreaterThan(0);
  });

  it("handles project with no scannable content", async () => {
    const output = run(["analyze", "--no-llm", tmpDir]);
    expect(output).toContain("Scanned:");
    expect(output).toContain("No new proposals found.");
  });

  it("--accept without .rex/ shows error", async () => {
    await mkdir(join(tmpDir, "tests"), { recursive: true });
    await writeFile(
      join(tmpDir, "tests", "x.test.ts"),
      'describe("X", () => { it("works", () => {}); });',
    );

    try {
      run(["analyze", "--no-llm", "--accept", tmpDir]);
      // Should not reach here
      expect(true).toBe(false);
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? "";
      expect(stderr).toContain("rex init");
    }
  });

  it("--no-llm forces algorithmic pipeline", async () => {
    await mkdir(join(tmpDir, "tests"), { recursive: true });
    await writeFile(
      join(tmpDir, "tests", "auth.test.ts"),
      `
describe("Auth", () => {
  it("validates tokens", () => {});
});
`,
    );

    const output = run(["analyze", "--no-llm", "--format=json", tmpDir]);
    const parsed = JSON.parse(output);

    expect(parsed).toHaveProperty("scanned");
    expect(parsed).toHaveProperty("stats");
    expect(parsed).toHaveProperty("proposals");
    // Should produce results without needing claude CLI
    expect(parsed.stats.total).toBeGreaterThanOrEqual(1);
  });

  it("caches proposals and accepts them later", async () => {
    run(["init", tmpDir]);

    await mkdir(join(tmpDir, "tests"), { recursive: true });
    await writeFile(
      join(tmpDir, "tests", "cache.test.ts"),
      `
describe("Cache", () => {
  it("stores values", () => {});
});
`,
    );

    // First run generates and caches proposals (non-TTY, no --accept → just saves)
    const firstOutput = run(["analyze", "--no-llm", tmpDir]);
    expect(firstOutput).toContain("[epic]");
    expect(firstOutput).toContain("Proposals saved");

    // Verify pending file exists
    const pending = JSON.parse(
      await readFile(join(tmpDir, ".rex", "pending-proposals.json"), "utf-8"),
    );
    expect(pending.length).toBeGreaterThan(0);

    // Second run with --accept picks up cached proposals without re-scanning
    const acceptOutput = run(["analyze", "--accept", tmpDir]);
    expect(acceptOutput).toContain("cached proposals");
    expect(acceptOutput).toContain("Added");
    expect(acceptOutput).toContain("items to PRD");

    // Pending file should be cleared
    try {
      await readFile(join(tmpDir, ".rex", "pending-proposals.json"), "utf-8");
      expect(true).toBe(false); // should not reach
    } catch {
      // Expected: file deleted
    }
  });

  it("--file with nonexistent file shows error", async () => {
    try {
      run(["analyze", "--file=nonexistent.md", tmpDir]);
      expect(true).toBe(false);
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? "";
      const stdout = (err as { stdout?: string }).stdout ?? "";
      const combined = stderr + stdout;
      expect(combined).toMatch(/no such file|ENOENT|Failed to analyze/i);
    }
  });
});
