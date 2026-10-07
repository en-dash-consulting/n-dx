import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// SIGTERM listeners seen when the progress file is first written, and during a phase.
const seen = vi.hoisted(() => ({ atStart: [] as number[], inPhase: [] as number[] }));

vi.mock("../../../src/analyzers/analyze-progress.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/analyzers/analyze-progress.js")>();
  return {
    ...original,
    startAnalyzeProgress: (...args: Parameters<typeof original.startAnalyzeProgress>) => {
      seen.atStart.push(process.listenerCount("SIGTERM"));
      return original.startAnalyzeProgress(...args);
    },
  };
});

vi.mock("../../../src/cli/commands/analyze-phases.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/cli/commands/analyze-phases.js")>()),
  runInventoryPhase: async () => {
    seen.inPhase.push(process.listenerCount("SIGTERM"));
  },
  runImportsPhase: async () => {},
  runClassificationsPhase: async () => {},
  runZonesPhase: async () => {},
  runComponentsPhase: async () => {},
  runCallGraphPhase: async () => {},
}));

import { cmdAnalyze } from "../../../src/cli/commands/analyze.js";
import { startAnalyzeProgress, finishAnalyzeProgress } from "../../../src/analyzers/analyze-progress.js";

describe("cmdAnalyze stop handlers", () => {
  let dir: string | null = null;
  afterEach(() => {
    seen.atStart.length = 0;
    seen.inPhase.length = 0;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  // #562: a SIGTERM sent once the file says running must reach the handler,
  // not the default disposition.
  it("are installed before the progress file is written, and removed afterwards", async () => {
    dir = mkdtempSync(join(tmpdir(), "sv-stop-handlers-"));
    const baseline = process.listenerCount("SIGTERM");

    await cmdAnalyze(dir, ["--fast"]);

    expect(seen.atStart).toEqual([baseline + 1]);
    expect(process.listenerCount("SIGTERM")).toBe(baseline);
  });

  it("are not installed by a run that does not own the progress file", async () => {
    dir = mkdtempSync(join(tmpdir(), "sv-stop-handlers-"));
    const baseline = process.listenerCount("SIGTERM");
    // Stands in for the outer run of a --deep analysis.
    expect(startAnalyzeProgress(join(dir, ".sourcevision"))).toBe(true);
    try {
      await cmdAnalyze(dir, ["--fast"]);
    } finally {
      finishAnalyzeProgress("complete");
    }

    expect(seen.inPhase).toEqual([baseline]);
  });
});
