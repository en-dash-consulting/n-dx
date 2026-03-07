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
    // Create a markdown doc that has content-level items in full mode
    await writeFile(
      join(tmpDir, "features.md"),
      `# Dashboard
- Display charts
- Export data
- Filter data
`,
    );

    const fullOutput = run(["analyze", "--no-llm", "--format=json", tmpDir]);
    const liteOutput = run(["analyze", "--no-llm", "--lite", "--format=json", tmpDir]);

    const fullParsed = JSON.parse(fullOutput);
    const liteParsed = JSON.parse(liteOutput);

    // Lite mode uses filenames only for docs (no bullet extraction)
    // Full mode extracts heading features + bullet tasks
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
    expect(output).toContain("Accepted");
    expect(output).toContain("items added to PRD");

    // Verify items in prd.json
    const prd = JSON.parse(
      await readFile(join(tmpDir, ".rex", "prd.json"), "utf-8"),
    );
    expect(prd.items.length).toBeGreaterThan(0);
  });

  it("logs batch acceptance record to execution log", async () => {
    run(["init", tmpDir]);

    await mkdir(join(tmpDir, "tests"), { recursive: true });
    await writeFile(
      join(tmpDir, "tests", "auth.test.ts"),
      `
describe("Auth", () => {
  it("validates tokens", () => {});
});
`,
    );

    run(["analyze", "--no-llm", "--accept", tmpDir]);

    // Read execution log and find the batch record
    const logContent = await readFile(
      join(tmpDir, ".rex", "execution-log.jsonl"),
      "utf-8",
    );
    const logLines = logContent.trim().split("\n").map((l) => JSON.parse(l));
    const acceptEntry = logLines.find(
      (e: { event: string }) => e.event === "analyze_accept",
    );

    expect(acceptEntry).toBeDefined();
    const detail = JSON.parse(acceptEntry.detail);
    expect(detail).toHaveProperty("totalProposals");
    expect(detail).toHaveProperty("acceptedCount");
    expect(detail).toHaveProperty("rejectedCount");
    expect(detail).toHaveProperty("accepted");
    expect(detail).toHaveProperty("rejected");
    expect(detail).toHaveProperty("mode");
    expect(detail.mode).toBe("auto");
    expect(detail.acceptedCount).toBeGreaterThan(0);
    expect(detail.rejectedCount).toBe(0);
    expect(detail.addedItemCount).toBeGreaterThan(0);
  });

  it("batch record includes accepted proposal titles", async () => {
    run(["init", tmpDir]);

    await writeFile(
      join(tmpDir, "features.md"),
      `# Dashboard
- Display charts
- Export data
`,
    );

    await mkdir(join(tmpDir, "tests"), { recursive: true });
    await writeFile(
      join(tmpDir, "tests", "billing.test.ts"),
      `
describe("Billing", () => {
  it("processes payments", () => {});
});
`,
    );

    run(["analyze", "--no-llm", "--accept", tmpDir]);

    const logContent = await readFile(
      join(tmpDir, ".rex", "execution-log.jsonl"),
      "utf-8",
    );
    const logLines = logContent.trim().split("\n").map((l) => JSON.parse(l));
    const acceptEntry = logLines.find(
      (e: { event: string }) => e.event === "analyze_accept",
    );

    const detail = JSON.parse(acceptEntry.detail);
    // accepted should be an array of epic titles
    expect(Array.isArray(detail.accepted)).toBe(true);
    expect(detail.accepted.length).toBe(detail.acceptedCount);
    // Each accepted title should be a non-empty string
    for (const title of detail.accepted) {
      expect(typeof title).toBe("string");
      expect(title.length).toBeGreaterThan(0);
    }
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
    expect(acceptOutput).toContain("Accepted");
    expect(acceptOutput).toContain("items added to PRD");

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

  it("--file imports a JSON file with --format=json", async () => {
    const content = JSON.stringify([
      {
        epic: { title: "Auth" },
        features: [
          { title: "Login", tasks: [{ title: "Validate email" }] },
        ],
      },
    ]);
    await writeFile(join(tmpDir, "spec.json"), content);

    const output = run(["analyze", "--file=spec.json", "--format=json", tmpDir]);
    const parsed = JSON.parse(output);

    expect(parsed).toHaveProperty("proposals");
    expect(parsed.proposals).toHaveLength(1);
    expect(parsed.proposals[0].epic.title).toBe("Auth");
  });

  it("multiple --file flags combine results", async () => {
    await writeFile(
      join(tmpDir, "auth.json"),
      JSON.stringify([
        {
          epic: { title: "Auth" },
          features: [
            { title: "Login", tasks: [{ title: "Validate email" }] },
          ],
        },
      ]),
    );
    await writeFile(
      join(tmpDir, "dashboard.json"),
      JSON.stringify([
        {
          epic: { title: "Dashboard" },
          features: [
            { title: "Charts", tasks: [{ title: "Render chart" }] },
          ],
        },
      ]),
    );

    const output = run([
      "analyze",
      "--file=auth.json",
      "--file=dashboard.json",
      "--format=json",
      tmpDir,
    ]);
    const parsed = JSON.parse(output);

    expect(parsed.proposals).toHaveLength(2);
    const epicTitles = parsed.proposals.map(
      (p: { epic: { title: string } }) => p.epic.title,
    );
    expect(epicTitles).toContain("Auth");
    expect(epicTitles).toContain("Dashboard");
  });

  it("multiple --file flags merge same-epic proposals", async () => {
    await writeFile(
      join(tmpDir, "auth1.json"),
      JSON.stringify([
        {
          epic: { title: "Auth" },
          features: [
            { title: "Login", tasks: [{ title: "Validate email" }] },
          ],
        },
      ]),
    );
    await writeFile(
      join(tmpDir, "auth2.json"),
      JSON.stringify([
        {
          epic: { title: "Auth" },
          features: [
            { title: "Signup", tasks: [{ title: "Create account" }] },
          ],
        },
      ]),
    );

    const output = run([
      "analyze",
      "--file=auth1.json",
      "--file=auth2.json",
      "--format=json",
      tmpDir,
    ]);
    const parsed = JSON.parse(output);

    expect(parsed.proposals).toHaveLength(1);
    expect(parsed.proposals[0].epic.title).toBe("Auth");
    const featureTitles = parsed.proposals[0].features.map(
      (f: { title: string }) => f.title,
    );
    expect(featureTitles).toContain("Login");
    expect(featureTitles).toContain("Signup");
  });

  it("multiple --file flags with --accept adds all items", async () => {
    run(["init", tmpDir]);

    await writeFile(
      join(tmpDir, "auth.json"),
      JSON.stringify([
        {
          epic: { title: "Auth" },
          features: [
            { title: "Login", tasks: [{ title: "Validate email" }] },
          ],
        },
      ]),
    );
    await writeFile(
      join(tmpDir, "dashboard.json"),
      JSON.stringify([
        {
          epic: { title: "Dashboard" },
          features: [
            { title: "Charts", tasks: [{ title: "Render chart" }] },
          ],
        },
      ]),
    );

    const output = run([
      "analyze",
      "--file=auth.json",
      "--file=dashboard.json",
      "--accept",
      tmpDir,
    ]);
    expect(output).toContain("Accepted");
    expect(output).toContain("items added to PRD");

    // Verify items in prd.json (items are nested: epics → features → tasks)
    const prd = JSON.parse(
      await readFile(join(tmpDir, ".rex", "prd.json"), "utf-8"),
    );
    function collectTitles(items: { title: string; children?: unknown[] }[]): string[] {
      const result: string[] = [];
      for (const item of items) {
        result.push(item.title);
        if (Array.isArray(item.children)) {
          result.push(...collectTitles(item.children as { title: string; children?: unknown[] }[]));
        }
      }
      return result;
    }
    const titles = collectTitles(prd.items);
    expect(titles).toContain("Auth");
    expect(titles).toContain("Dashboard");
    expect(titles).toContain("Login");
    expect(titles).toContain("Charts");
  });

  it("shows diff view when importing into existing PRD", async () => {
    run(["init", tmpDir]);

    // First import to populate the PRD
    await writeFile(
      join(tmpDir, "initial.json"),
      JSON.stringify([
        {
          epic: { title: "Auth" },
          features: [
            { title: "Login", tasks: [{ title: "Validate email" }] },
          ],
        },
      ]),
    );
    run(["analyze", "--file=initial.json", "--accept", tmpDir]);

    // Second import with overlapping + new content
    await writeFile(
      join(tmpDir, "update.json"),
      JSON.stringify([
        {
          epic: { title: "Auth" },
          features: [
            { title: "Login", tasks: [{ title: "Validate email" }, { title: "Handle OAuth" }] },
            { title: "Signup", tasks: [] },
          ],
        },
        {
          epic: { title: "Dashboard" },
          features: [
            { title: "Charts", tasks: [] },
          ],
        },
      ]),
    );
    const output = run(["analyze", "--file=update.json", tmpDir]);

    // Should show diff markers
    expect(output).toContain("~ [epic] Auth");       // existing epic with new children
    expect(output).toContain("+ [epic] Dashboard");  // new epic
    expect(output).toContain("+   [feature] Signup"); // new feature
    expect(output).toContain("Summary:");
    expect(output).toContain("to add");
  });

  it("multiple --file flags with mixed formats", async () => {
    await writeFile(
      join(tmpDir, "features.json"),
      JSON.stringify([
        { title: "User Management", description: "CRUD for users" },
      ]),
    );
    await writeFile(
      join(tmpDir, "more.yaml"),
      "title: API Gateway\ndescription: Route requests\n",
    );

    const output = run([
      "analyze",
      "--file=features.json",
      "--file=more.yaml",
      "--format=json",
      tmpDir,
    ]);
    const parsed = JSON.parse(output);

    const allFeatures = parsed.proposals.flatMap(
      (p: { features: { title: string }[] }) =>
        p.features.map((f) => f.title),
    );
    expect(allFeatures).toContain("User Management");
    expect(allFeatures).toContain("API Gateway");
  });

  it("--model flag is accepted without error", async () => {
    await mkdir(join(tmpDir, "tests"), { recursive: true });
    await writeFile(
      join(tmpDir, "tests", "model.test.ts"),
      `
describe("Model", () => {
  it("works", () => {});
});
`,
    );

    // --no-llm skips the actual LLM call, but --model should still be
    // parsed without error and not break the pipeline
    const output = run([
      "analyze",
      "--no-llm",
      "--model=claude-sonnet-4-6",
      "--format=json",
      tmpDir,
    ]);
    const parsed = JSON.parse(output);

    expect(parsed).toHaveProperty("scanned");
    expect(parsed).toHaveProperty("proposals");
  });

  it("--chunk-size flag is accepted without error", async () => {
    await mkdir(join(tmpDir, "tests"), { recursive: true });
    await writeFile(
      join(tmpDir, "tests", "chunk.test.ts"),
      `
describe("Chunk", () => {
  it("works", () => {});
});
`,
    );

    // --chunk-size should parse without error (non-TTY won't reach interactive review)
    const output = run([
      "analyze",
      "--no-llm",
      "--chunk-size=10",
      "--format=json",
      tmpDir,
    ]);
    const parsed = JSON.parse(output);

    expect(parsed).toHaveProperty("scanned");
    expect(parsed).toHaveProperty("proposals");
  });

  it("--chunk-size rejects non-positive-integer values", async () => {
    try {
      run(["analyze", "--no-llm", "--chunk-size=0", tmpDir]);
      expect(true).toBe(false);
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? "";
      expect(stderr).toContain("Invalid --chunk-size");
    }
  });

  it("--chunk-size rejects non-numeric values", async () => {
    try {
      run(["analyze", "--no-llm", "--chunk-size=abc", tmpDir]);
      expect(true).toBe(false);
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? "";
      expect(stderr).toContain("Invalid --chunk-size");
    }
  });

  it("--chunk-size rejects negative values", async () => {
    try {
      run(["analyze", "--no-llm", "--chunk-size=-3", tmpDir]);
      expect(true).toBe(false);
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? "";
      expect(stderr).toContain("Invalid --chunk-size");
    }
  });

  it("--chunk-size rejects float values", async () => {
    try {
      run(["analyze", "--no-llm", "--chunk-size=2.5", tmpDir]);
      expect(true).toBe(false);
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr ?? "";
      expect(stderr).toContain("Invalid --chunk-size");
    }
  });

  it("reads model from config.json when --model not provided", async () => {
    run(["init", tmpDir]);

    // Write a model into config
    const configPath = join(tmpDir, ".rex", "config.json");
    const config = JSON.parse(await readFile(configPath, "utf-8"));
    config.model = "claude-haiku-4-20250414";
    await writeFile(configPath, JSON.stringify(config, null, 2));

    await mkdir(join(tmpDir, "tests"), { recursive: true });
    await writeFile(
      join(tmpDir, "tests", "cfg.test.ts"),
      `
describe("Cfg", () => {
  it("runs", () => {});
});
`,
    );

    // Should not error — config model is resolved but --no-llm skips LLM call
    const output = run(["analyze", "--no-llm", "--format=json", tmpDir]);
    const parsed = JSON.parse(output);

    expect(parsed).toHaveProperty("scanned");
    expect(parsed).toHaveProperty("proposals");
  });
});
