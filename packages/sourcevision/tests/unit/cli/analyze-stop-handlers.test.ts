import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// SIGTERM listeners seen when the progress file is first written, when it is
// last written, and during a phase.
const seen = vi.hoisted(() => ({
  atStart: [] as number[],
  atFinish: [] as number[],
  inPhase: [] as number[],
  /** Set by a test to make the inventory phase throw, so the run ends `failed`. */
  failInventory: false,
}));

vi.mock("../../../src/analyzers/analyze-progress.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/analyzers/analyze-progress.js")>();
  return {
    ...original,
    startAnalyzeProgress: (...args: Parameters<typeof original.startAnalyzeProgress>) => {
      seen.atStart.push(process.listenerCount("SIGTERM"));
      return original.startAnalyzeProgress(...args);
    },
    finishAnalyzeProgress: (...args: Parameters<typeof original.finishAnalyzeProgress>) => {
      seen.atFinish.push(process.listenerCount("SIGTERM"));
      return original.finishAnalyzeProgress(...args);
    },
  };
});

vi.mock("../../../src/cli/commands/analyze-phases.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/cli/commands/analyze-phases.js")>()),
  runInventoryPhase: async () => {
    seen.inPhase.push(process.listenerCount("SIGTERM"));
    if (seen.failInventory) throw new Error("inventory exploded");
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
    seen.atFinish.length = 0;
    seen.inPhase.length = 0;
    seen.failInventory = false;
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  // #562: a SIGTERM sent once the file says running must reach the handler,
  // not the default disposition. Both ends of the run: the handlers go in
  // before the first write and come out after the last one, so the file never
  // says `running` with no handler installed.
  it("are installed before the progress file is written, and removed afterwards", async () => {
    dir = mkdtempSync(join(tmpdir(), "sv-stop-handlers-"));
    const baseline = process.listenerCount("SIGTERM");
    const sigintBaseline = process.listenerCount("SIGINT");

    await cmdAnalyze(dir, ["--fast"]);

    expect(seen.atStart).toEqual([baseline + 1]);
    expect(seen.atFinish).toEqual([baseline + 1]);
    expect(process.listenerCount("SIGTERM")).toBe(baseline);
    expect(process.listenerCount("SIGINT")).toBe(sigintBaseline);
  });

  // The run failed rather than completed, so the last write is `failed` — the
  // handlers must still be installed for it, same as for `complete`.
  it("are still installed for the final write when the run fails", async () => {
    dir = mkdtempSync(join(tmpdir(), "sv-stop-handlers-"));
    const baseline = process.listenerCount("SIGTERM");
    seen.failInventory = true;

    await expect(cmdAnalyze(dir, ["--fast"])).rejects.toThrow("inventory exploded");

    expect(seen.atFinish).toEqual([baseline + 1]);
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
