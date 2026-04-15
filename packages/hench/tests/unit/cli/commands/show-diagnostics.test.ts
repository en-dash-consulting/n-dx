import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { RunRecord } from "../../../../src/schema/index.js";
import { saveRun } from "../../../../src/store/runs.js";
import { initConfig } from "../../../../src/store/config.js";

describe("show command diagnostics display", () => {
  let projectDir: string;
  let henchDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  const makeRun = (overrides?: Partial<RunRecord>): RunRecord => ({
    id: "run-diag-001",
    taskId: "task-diag",
    taskTitle: "Diagnostics test task",
    startedAt: "2025-01-01T00:00:00.000Z",
    finishedAt: "2025-01-01T00:01:00.000Z",
    status: "completed",
    turns: 3,
    tokenUsage: { input: 1000, output: 500 },
    toolCalls: [],
    model: "sonnet",
    ...overrides,
  });

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-show-diag-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("displays all diagnostics fields when present", async () => {
    const run = makeRun({
      diagnostics: {
        tokenDiagnosticStatus: "complete",
        parseMode: "stream-json",
        notes: ["note-1"],
        vendor: "claude",
        sandbox: "workspace-write",
        approvals: "never",
      },
    });
    await saveRun(henchDir, run);

    const { cmdShow } = await import("../../../../src/cli/commands/show.js");
    await cmdShow(projectDir, "run-diag-001", {});

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("Diagnostics:");
    expect(allOutput).toContain("Vendor: claude");
    expect(allOutput).toContain("Parse mode: stream-json");
    expect(allOutput).toContain("Sandbox: workspace-write");
    expect(allOutput).toContain("Approvals: never");
    expect(allOutput).toContain("Token status: complete");
    expect(allOutput).toContain("Notes: note-1");
  });

  it("omits optional fields when not present", async () => {
    const run = makeRun({
      diagnostics: {
        tokenDiagnosticStatus: "unavailable",
        parseMode: "api-sdk",
        notes: [],
      },
    });
    await saveRun(henchDir, run);

    const { cmdShow } = await import("../../../../src/cli/commands/show.js");
    await cmdShow(projectDir, "run-diag-001", {});

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("Diagnostics:");
    expect(allOutput).toContain("Parse mode: api-sdk");
    expect(allOutput).toContain("Token status: unavailable");
    // vendor/sandbox/approvals not present — should not appear
    expect(allOutput).not.toContain("Vendor:");
    expect(allOutput).not.toContain("Sandbox:");
    expect(allOutput).not.toContain("Approvals:");
    expect(allOutput).not.toContain("Notes:");
  });

  it("displays prompt sections in diagnostics", async () => {
    const run = makeRun({
      diagnostics: {
        tokenDiagnosticStatus: "complete",
        parseMode: "stream-json",
        notes: [],
        vendor: "claude",
        promptSections: [
          { name: "system", byteLength: 2048 },
          { name: "brief", byteLength: 4096 },
        ],
      },
    });
    await saveRun(henchDir, run);

    const { cmdShow } = await import("../../../../src/cli/commands/show.js");
    await cmdShow(projectDir, "run-diag-001", {});

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("Prompt sections:");
    expect(allOutput).toContain("system: 2048 bytes");
    expect(allOutput).toContain("brief: 4096 bytes");
  });

  it("does not display diagnostics section when absent", async () => {
    const run = makeRun(); // no diagnostics
    await saveRun(henchDir, run);

    const { cmdShow } = await import("../../../../src/cli/commands/show.js");
    await cmdShow(projectDir, "run-diag-001", {});

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).not.toContain("Diagnostics:");
  });

  it("old records without diagnostics remain valid through JSON round-trip", async () => {
    // Simulate an old record without any diagnostics field
    const run = makeRun();
    await saveRun(henchDir, run);

    const { cmdShow } = await import("../../../../src/cli/commands/show.js");
    // Should not crash
    await expect(cmdShow(projectDir, "run-diag-001", {})).resolves.not.toThrow();

    const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(allOutput).toContain("run-diag-001");
    expect(allOutput).not.toContain("Diagnostics:");
  });
});
