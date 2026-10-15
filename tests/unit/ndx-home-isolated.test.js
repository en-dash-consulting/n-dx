/**
 * Guards tests/setup-ndx-home.js: the root suite runs sourcevision's analysis,
 * and `~/.ndx/packs` on a developer's machine must never shadow a workspace
 * pack. Fails if the setupFile is dropped from vitest.config.js.
 */
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ndx home is isolated for the test process", () => {
  it("points NDX_HOME at an existing temp directory, not the user's home", () => {
    const home = process.env.NDX_HOME;
    expect(home).toBeTruthy();
    expect(dirname(resolve(home))).toBe(resolve(tmpdir()));
    expect(existsSync(home)).toBe(true);
    expect(process.env.N_DX_HOME).toBeUndefined();
  });
});
