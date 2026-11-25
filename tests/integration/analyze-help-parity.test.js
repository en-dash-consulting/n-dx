/**
 * Cross-tier contract: `ndx analyze --help` and `sv analyze --help` say the
 * same thing about what each mode sends to a model.
 *
 * The text is defined twice because core is orchestration-tier and may not
 * import sourcevision: `ANALYZE_MODEL_USE` in `packages/core/help.js` and in
 * `packages/sourcevision/src/cli/help.ts`. A drift would tell a user one
 * command sends nothing while the other says it does.
 */

import { describe, it, expect } from "vitest";
import { ANALYZE_MODEL_USE as coreText, formatOrchestratorCommandHelp } from "../../packages/core/help.js";

// Compiled artifact, so this tests the help as it actually ships.
const sv = await import("../../packages/sourcevision/dist/cli/help.js");

describe("analyze help model-use parity", () => {
  it("core and sourcevision carry the same Model use text", () => {
    expect(coreText).toBe(sv.ANALYZE_MODEL_USE);
  });

  it("both helps print it", () => {
    const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
    expect(strip(formatOrchestratorCommandHelp("analyze"))).toContain(coreText.split("\n")[0]);
    expect(strip(sv.getCommandHelp("analyze"))).toContain(coreText.split("\n")[0]);
  });
});
