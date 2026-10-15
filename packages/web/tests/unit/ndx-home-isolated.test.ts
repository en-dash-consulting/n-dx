/**
 * Guards tests/setup-ndx-home.js (wired in vitest.config.ts): web's suite runs
 * sourcevision's analysis, and a developer's real `~/.ndx/packs` must never
 * shadow a workspace pack.
 */
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ndx home is isolated for the test process", () => {
  it("points N_DX_HOME at an existing temp directory and leaves NDX_HOME unset", () => {
    const home = process.env["N_DX_HOME"];
    expect(home).toBeTruthy();
    expect(dirname(resolve(home!))).toBe(resolve(tmpdir()));
    expect(existsSync(home!)).toBe(true);
    expect(process.env["NDX_HOME"]).toBeUndefined();
  });
});
