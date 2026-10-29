/**
 * A repository whose protected config cannot be snapshotted refuses the run
 * with a message naming the path, rather than crashing `ndx work` with a raw
 * filesystem error before the run has started.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureConfigBackstop } from "../../../../src/cli/commands/run.js";
import { CLIError } from "../../../../src/cli/errors.js";

let dir: string;

beforeEach(() => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), "hench-backstop-capture-")));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("captureConfigBackstop", () => {
  it("refuses the run with a CLIError naming a protected directory that is a link loop", () => {
    symlinkSync(".claude", join(dir, ".claude"));

    let thrown: unknown;
    try {
      captureConfigBackstop(dir);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CLIError);
    expect((thrown as CLIError).message).toMatch(/Cannot snapshot n-dx's own config before the run: \.claude\/settings\.json could not be read/);
  });

  it("snapshots a project with ordinary config", () => {
    expect(captureConfigBackstop(dir).restore()).toEqual([]);
  });
});
