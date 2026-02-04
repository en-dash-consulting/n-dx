import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { cmdVerify } from "../../../../src/cli/commands/verify.js";
import { CLIError } from "../../../../src/cli/errors.js";
import type { PRDDocument } from "../../../../src/schema/index.js";
import type { RexConfig } from "../../../../src/schema/v1.js";

function writePRD(dir: string, doc: PRDDocument): void {
  writeFileSync(join(dir, ".rex", "prd.json"), JSON.stringify(doc));
}

function writeConfig(dir: string, config: RexConfig): void {
  writeFileSync(join(dir, ".rex", "config.json"), JSON.stringify(config));
}

const BASE_CONFIG: RexConfig = {
  schema: "rex/v1",
  project: "test",
  adapter: "file",
};

const PRD_WITH_CRITERIA: PRDDocument = {
  schema: "rex/v1",
  title: "Test Project",
  items: [
    {
      id: "e1",
      title: "Auth Epic",
      level: "epic",
      status: "in_progress",
      children: [
        {
          id: "t1",
          title: "Login feature",
          level: "task",
          status: "pending",
          acceptanceCriteria: [
            "User can login successfully",
            "Shows error on invalid credentials",
          ],
        },
      ],
    },
    {
      id: "t2",
      title: "Status display",
      level: "task",
      status: "pending",
      acceptanceCriteria: [
        "Show status results clearly",
      ],
    },
  ],
};

const PRD_NO_CRITERIA: PRDDocument = {
  schema: "rex/v1",
  title: "Test Project",
  items: [
    {
      id: "t1",
      title: "Simple task",
      level: "task",
      status: "pending",
    },
  ],
};

describe("cmdVerify", () => {
  let tmp: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-verify-cmd-"));
    mkdirSync(join(tmp, ".rex"));
    writeConfig(tmp, BASE_CONFIG);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    rmSync(tmp, { recursive: true });
  });

  function output(): string {
    return logSpy.mock.calls.map((c) => c[0] ?? "").join("\n");
  }

  it("shows message when no tasks have acceptance criteria", async () => {
    writePRD(tmp, PRD_NO_CRITERIA);
    await cmdVerify(tmp, { "dry-run": "true" });
    expect(output()).toContain("No tasks with acceptance criteria found");
  });

  it("shows per-task criteria with coverage indicators", async () => {
    writePRD(tmp, PRD_WITH_CRITERIA);
    // Create a test file that matches "login"
    mkdirSync(join(tmp, "tests"), { recursive: true });
    writeFileSync(join(tmp, "tests", "login.test.ts"), "");

    await cmdVerify(tmp, { "dry-run": "true" });
    const out = output();

    expect(out).toContain("Login feature");
    expect(out).toContain("User can login successfully");
    expect(out).toContain("Coverage:");
  });

  it("filters to a single task with --task flag", async () => {
    writePRD(tmp, PRD_WITH_CRITERIA);
    await cmdVerify(tmp, { task: "t2", "dry-run": "true" });
    const out = output();

    expect(out).toContain("Status display");
    expect(out).not.toContain("Login feature");
  });

  it("throws CLIError for unknown task ID", async () => {
    writePRD(tmp, PRD_WITH_CRITERIA);
    await expect(cmdVerify(tmp, { task: "nonexistent" })).rejects.toThrow(CLIError);
    await expect(cmdVerify(tmp, { task: "nonexistent" })).rejects.toThrow(
      /not found/,
    );
  });

  it("outputs JSON with --format=json", async () => {
    writePRD(tmp, PRD_WITH_CRITERIA);
    await cmdVerify(tmp, { format: "json", "dry-run": "true" });
    const out = output();
    const parsed = JSON.parse(out);

    expect(parsed.tasks).toBeInstanceOf(Array);
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.totalTasks).toBe(2);
    expect(parsed.summary.totalCriteria).toBe(3);
  });

  it("shows coverage icons (✓ for covered, ✗ for uncovered)", async () => {
    writePRD(tmp, PRD_WITH_CRITERIA);
    // Create a test file that matches "login"
    mkdirSync(join(tmp, "tests"), { recursive: true });
    writeFileSync(join(tmp, "tests", "login.test.ts"), "");

    await cmdVerify(tmp, { "dry-run": "true" });
    const out = output();

    // Login criterion should be covered (login.test.ts matches)
    expect(out).toContain("✓");
  });

  it("shows summary line with coverage count", async () => {
    writePRD(tmp, PRD_WITH_CRITERIA);
    await cmdVerify(tmp, { "dry-run": "true" });
    const out = output();

    expect(out).toMatch(/\d+\/\d+ criteria covered across \d+ task/);
  });

  it("shows message for task ID with no criteria", async () => {
    const prd: PRDDocument = {
      schema: "rex/v1",
      title: "Test",
      items: [
        { id: "t1", title: "No criteria", level: "task", status: "pending" },
      ],
    };
    writePRD(tmp, prd);
    await cmdVerify(tmp, { task: "t1", "dry-run": "true" });
    expect(output()).toContain("No acceptance criteria found for this task");
  });

  it("warns when no test command is configured", async () => {
    writePRD(tmp, PRD_WITH_CRITERIA);
    mkdirSync(join(tmp, "tests"), { recursive: true });
    writeFileSync(join(tmp, "tests", "login.test.ts"), "");

    await cmdVerify(tmp, {});
    const out = output();

    expect(out).toContain("No test command configured");
  });
});
