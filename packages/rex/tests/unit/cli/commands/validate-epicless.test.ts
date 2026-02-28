import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { cmdValidate } from "../../../../src/cli/commands/validate.js";
import type { PRDDocument } from "../../../../src/schema/index.js";

function writePRD(dir: string, doc: PRDDocument): void {
  writeFileSync(join(dir, ".rex", "prd.json"), JSON.stringify(doc));
}

function writeConfig(dir: string, config: Record<string, unknown>): void {
  writeFileSync(join(dir, ".rex", "config.json"), JSON.stringify(config));
}

function readPRD(dir: string): PRDDocument {
  return JSON.parse(readFileSync(join(dir, ".rex", "prd.json"), "utf-8"));
}

const VALID_CONFIG = {
  schema: "rex/v1",
  project: "test-epicless",
  adapter: "file",
};

/**
 * PRD with a feature at root level (epicless) — a hierarchy violation.
 */
function epiclessPRD(): PRDDocument {
  return {
    schema: "rex/v1",
    title: "Test Project",
    items: [
      {
        id: "e1",
        title: "Epic One",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "t1",
            title: "Task",
            level: "task",
            status: "pending",
          },
        ],
      },
      {
        id: "f-orphan",
        title: "Orphan Feature",
        level: "feature",
        status: "pending",
        children: [
          {
            id: "t-orphan",
            title: "Orphan Task",
            level: "task",
            status: "pending",
          },
        ],
      },
    ],
  };
}

describe("cmdValidate — epicless feature interactive resolution", () => {
  let tmpDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "rex-validate-epicless-"));
    mkdirSync(join(tmpDir, ".rex"), { recursive: true });
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("detects epicless features and includes them in JSON output", async () => {
    writeConfig(tmpDir, VALID_CONFIG);
    writePRD(tmpDir, epiclessPRD());

    // JSON mode — no interactive prompts, just reports
    await expect(cmdValidate(tmpDir, { format: "json" })).rejects.toThrow(
      "process.exit",
    );

    const jsonCall = stdoutSpy.mock.calls.find((c) => {
      try {
        JSON.parse(c[0]);
        return true;
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();
    const report = JSON.parse(jsonCall![0]);
    expect(report.epiclessFeatures).toBeDefined();
    expect(report.epiclessFeatures).toHaveLength(1);
    expect(report.epiclessFeatures[0].itemId).toBe("f-orphan");
    expect(report.epiclessFeatures[0].title).toBe("Orphan Feature");
  });

  it("does not include epiclessFeatures in JSON when none exist", async () => {
    writeConfig(tmpDir, VALID_CONFIG);
    writePRD(tmpDir, {
      schema: "rex/v1",
      title: "Clean",
      items: [
        {
          id: "e1",
          title: "Epic",
          level: "epic",
          status: "pending",
          children: [
            {
              id: "t1",
              title: "Task",
              level: "task",
              status: "completed",
              startedAt: "2026-01-01T00:00:00.000Z",
              completedAt: "2026-01-02T00:00:00.000Z",
            },
          ],
        },
      ],
    });

    await cmdValidate(tmpDir, { format: "json" });

    const jsonCall = stdoutSpy.mock.calls.find((c) => {
      try {
        JSON.parse(c[0]);
        return true;
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();
    const report = JSON.parse(jsonCall![0]);
    expect(report.epiclessFeatures).toBeUndefined();
  });

  it("correlates feature under epic via interactive prompt", async () => {
    writeConfig(tmpDir, VALID_CONFIG);
    writePRD(tmpDir, epiclessPRD());

    let promptIdx = 0;
    const answers = ["1", "1"]; // correlate, pick first epic
    const mockPrompt = async () => answers[promptIdx++];

    // Will exit(1) because hierarchy placement error still triggers exit before interactive fix
    // But the interactive fix runs and saves the document
    await expect(
      cmdValidate(tmpDir, {}, { prompt: mockPrompt }),
    ).rejects.toThrow("process.exit");

    // Verify the PRD was saved with the feature moved under the epic
    const updatedDoc = readPRD(tmpDir);
    const e1 = updatedDoc.items.find((i) => i.id === "e1");
    expect(e1?.children?.find((c) => c.id === "f-orphan")).toBeDefined();
    // Feature's children should be preserved
    const movedFeature = e1?.children?.find((c) => c.id === "f-orphan");
    expect(movedFeature?.children?.find((c) => c.id === "t-orphan")).toBeDefined();
  });

  it("deletes feature via interactive prompt", async () => {
    writeConfig(tmpDir, VALID_CONFIG);
    writePRD(tmpDir, epiclessPRD());

    let promptIdx = 0;
    const answers = ["2"]; // delete
    const mockPrompt = async () => answers[promptIdx++];

    await expect(
      cmdValidate(tmpDir, {}, { prompt: mockPrompt }),
    ).rejects.toThrow("process.exit");

    const updatedDoc = readPRD(tmpDir);
    expect(updatedDoc.items.find((i) => i.id === "f-orphan")).toBeUndefined();
    // Only epic remains
    expect(updatedDoc.items).toHaveLength(1);
    expect(updatedDoc.items[0].id).toBe("e1");
  });

  it("skips feature via interactive prompt without modifying PRD", async () => {
    writeConfig(tmpDir, VALID_CONFIG);
    const original = epiclessPRD();
    writePRD(tmpDir, original);

    let promptIdx = 0;
    const answers = ["3"]; // skip
    const mockPrompt = async () => answers[promptIdx++];

    await expect(
      cmdValidate(tmpDir, {}, { prompt: mockPrompt }),
    ).rejects.toThrow("process.exit");

    const updatedDoc = readPRD(tmpDir);
    // Feature should still be at root
    expect(updatedDoc.items.find((i) => i.id === "f-orphan")).toBeDefined();
    expect(updatedDoc.items).toHaveLength(2);
  });

  it("handles invalid input by defaulting to skip", async () => {
    writeConfig(tmpDir, VALID_CONFIG);
    writePRD(tmpDir, epiclessPRD());

    let promptIdx = 0;
    const answers = ["garbage"]; // invalid
    const mockPrompt = async () => answers[promptIdx++];

    await expect(
      cmdValidate(tmpDir, {}, { prompt: mockPrompt }),
    ).rejects.toThrow("process.exit");

    const updatedDoc = readPRD(tmpDir);
    // Feature should still be at root (treated as skip)
    expect(updatedDoc.items.find((i) => i.id === "f-orphan")).toBeDefined();
  });

  it("does not prompt in JSON mode even with epicless features", async () => {
    writeConfig(tmpDir, VALID_CONFIG);
    writePRD(tmpDir, epiclessPRD());

    let promptCalled = false;
    const mockPrompt = async () => {
      promptCalled = true;
      return "3";
    };

    // JSON mode — prompt should not be called
    await expect(
      cmdValidate(tmpDir, { format: "json" }, { prompt: mockPrompt }),
    ).rejects.toThrow("process.exit");

    expect(promptCalled).toBe(false);
  });

  it("writes execution log entry after resolution", async () => {
    writeConfig(tmpDir, VALID_CONFIG);
    writePRD(tmpDir, epiclessPRD());

    let promptIdx = 0;
    const answers = ["1", "1"]; // correlate
    const mockPrompt = async () => answers[promptIdx++];

    await expect(
      cmdValidate(tmpDir, {}, { prompt: mockPrompt }),
    ).rejects.toThrow("process.exit");

    // Check execution log
    const logPath = join(tmpDir, ".rex", "execution-log.jsonl");
    const logContent = readFileSync(logPath, "utf-8");
    expect(logContent).toContain("validate_interactive_fix");
    expect(logContent).toContain("epicless feature");
  });

  it("maintains backward compatibility — no prompt without options.prompt and non-TTY", async () => {
    writeConfig(tmpDir, VALID_CONFIG);
    writePRD(tmpDir, epiclessPRD());

    // No options.prompt, and process.stdin.isTTY is likely false in test env
    await expect(cmdValidate(tmpDir, {})).rejects.toThrow("process.exit");

    // PRD should be unchanged (no interactive resolution happened)
    const updatedDoc = readPRD(tmpDir);
    expect(updatedDoc.items.find((i) => i.id === "f-orphan")).toBeDefined();
  });
});
