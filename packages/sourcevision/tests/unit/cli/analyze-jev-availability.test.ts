/**
 * `finalizeTokenUsage` records on `manifest.lastAnalysis.jev` what this run's
 * own call to a helper-backed TypeSafe key gave, and never runs the helper
 * itself: a run that did not ask Jev records it unknown.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveCredential, setHelperCredential, TYPESAFE_CREDENTIAL } from "@n-dx/llm-client";
import { finalizeTokenUsage } from "../../../src/cli/commands/analyze.js";
import type { AnalyzeContext } from "../../../src/cli/commands/analyze-phases.js";
import { readManifest } from "../../../src/analyzers/manifest.js";
import { startRunLedger } from "../../../src/analyzers/run-ledger.js";

let root: string;
let home: string;
let project: string;
let marker: string;
let savedHome: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sv-analyze-jev-"));
  home = join(root, "home");
  project = join(root, "project");
  marker = join(root, "helper-ran");
  for (const dir of [home, project]) mkdirSync(dir);
  savedHome = process.env["NDX_HOME"];
  process.env["NDX_HOME"] = home;
  // A failing helper that leaves a marker. Its path is unique to this test,
  // so llm-client's per-process helper cache holds no earlier result for it.
  const script = join(root, "get-key.mjs");
  writeFileSync(script, `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\nprocess.exit(1);\n`);
  setHelperCredential(TYPESAFE_CREDENTIAL, [process.execPath, script]);
  startRunLedger("fast");
});

afterEach(() => {
  if (savedHome === undefined) delete process.env["NDX_HOME"];
  else process.env["NDX_HOME"] = savedHome;
  rmSync(root, { recursive: true, force: true });
});

function finalize(): NonNullable<ReturnType<typeof readManifest>["lastAnalysis"]>["jev"] {
  const ctx = {
    absDir: project,
    svDir: join(project, ".sourcevision"),
    tokenUsage: { calls: 0, inputTokens: 0, outputTokens: 0 },
  } as AnalyzeContext;
  finalizeTokenUsage(ctx, {});
  return readManifest(project).lastAnalysis?.jev;
}

describe("analyze records Jev availability from the run's helper call", () => {
  it("records unavailable when the helper failed during the run", () => {
    // What a Jev route does: resolve the key once.
    expect(resolveCredential(TYPESAFE_CREDENTIAL, { warn: () => {} })).toBeUndefined();
    expect(existsSync(marker)).toBe(true);
    expect(finalize()).toEqual({ available: false, source: null });
  });

  it("records unknown, and runs no helper, when the run never asked Jev", () => {
    expect(finalize()).toEqual({ available: null, source: "helper" });
    expect(existsSync(marker)).toBe(false);
  });
});
