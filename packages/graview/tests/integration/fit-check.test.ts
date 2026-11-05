/**
 * `ndx graview check` fails on a snapshot the declaration does not admit,
 * even when `graview check`, which judges the declaration alone, passes.
 * The graview binary is a `.js` stub that exits 0, so only the fit can fail.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveLayout } from "../../src/llm-gateway.js";
import { GRAVIEW_BIN_ENV } from "../../src/graview-bin.js";
import { main } from "../../src/cli/index.js";
import { makeProject, ZONES } from "../helpers/project.js";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ndx graview check", () => {
  it("fails, naming the record, when the snapshot does not fit, even though graview check passes", async () => {
    const root = makeProject();
    const bin = mkdtempSync(join(tmpdir(), "graview-fit-bin-"));
    roots.push(root, bin);
    const layout = resolveLayout(root);
    const zones = structuredClone(ZONES);
    zones.zones[1]!.cohesion = 1.5;
    writeFileSync(join(layout.sourcevisionDir, "zones.json"), JSON.stringify(zones));
    // A graview that passes whatever it is given: only the fit can fail the command.
    writeFileSync(join(bin, "graview.cjs"), "process.exit(0);\n");
    vi.stubEnv(GRAVIEW_BIN_ENV, join(bin, "graview.cjs"));
    vi.stubEnv("NDX_HOME", join(bin, "home"));
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation((line: unknown) => void errors.push(String(line)));
    expect(await main(["emit", root, "--quiet"])).toBe(0);
    expect(errors.join("\n")).toMatch(/^warning: 1 misfit in 1 record/m);
    errors.length = 0;
    expect(await main(["check", root, "--quiet"])).toBe(1);
    expect(errors.join("\n")).toMatch(/^error: 1 misfit in 1 record[^]*catalog: zone\.cohesion is 1\.5, above the declared maximum 1/m);
  });
});
