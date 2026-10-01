import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../../src/cli/commands/analyze-phases.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/cli/commands/analyze-phases.js")>()),
  runInventoryPhase: async () => {},
  runImportsPhase: async () => {},
  runClassificationsPhase: async () => {},
  runZonesPhase: async () => {},
  runComponentsPhase: async () => {},
  runCallGraphPhase: async () => {},
}));

// An error after the last phase: carrying a previous narrator's work forward.
vi.mock("../../../src/cli/commands/narrate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/cli/commands/narrate.js")>()),
  takeOverNarration: () => ({ stopped: undefined, zones: ["z"], names: [] }),
  carryNarration: () => {
    throw new Error("carry exploded");
  },
}));

import { cmdAnalyze } from "../../../src/cli/commands/analyze.js";
import { analyzeProgressPath } from "../../../src/analyzers/analyze-progress.js";

describe("cmdAnalyze failure after the last phase", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("records the error in the progress file", async () => {
    dir = mkdtempSync(join(tmpdir(), "sv-post-phase-"));
    await expect(cmdAnalyze(dir, [])).rejects.toThrow("carry exploded");

    const svDir = join(dir, ".sourcevision");
    const progress = JSON.parse(readFileSync(analyzeProgressPath(svDir), "utf-8"));
    expect(progress.status).toBe("failed");
    expect(progress.error).toContain("carry exploded");
  });
});
