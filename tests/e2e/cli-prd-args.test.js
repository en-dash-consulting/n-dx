/**
 * `ndx prd` argument contract: path-valued flags must be written --flag=value.
 *
 * The orchestrator's flag model keeps only `-`-prefixed tokens and treats the
 * last bare token as the project directory, so in `ndx prd export --out
 * bundle.json .` the path was dropped from the spawn and rex received `--out .`
 * — an attempted write to the project directory itself, failing with a raw
 * rename error and a stray `<dir>.<pid>.<uuid>.tmp` file beside the project.
 * rex's own parser accepts the space form; the garbling was purely this tier,
 * so this tier rejects the form up front with an actionable message.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { runFail, createTmpDir, removeTmpDir } from "./e2e-helpers.js";

describe("ndx prd rejects space-separated path flags", () => {
  let projectDir;

  beforeEach(async () => {
    projectDir = await createTmpDir("ndx-prd-args-");
  });

  afterEach(async () => {
    await removeTmpDir(projectDir);
  });

  /** Everything beside the project dir that carries its name — stray tmp files land there. */
  function siblingsOfProject() {
    return readdirSync(dirname(projectDir)).filter(
      (entry) => entry.startsWith(basename(projectDir)) && entry !== basename(projectDir),
    );
  }

  function expectRejected(args, flag) {
    const { status, stdout, stderr } = runFail(args);
    const output = stdout + stderr;

    expect(status).not.toBe(0);
    expect(output).toMatch(new RegExp(`${flag} needs a value`));
    expect(output).toMatch(new RegExp(`${flag}=`));
    // Rejected before anything ran: no project state, no stray temp files.
    expect(readdirSync(projectDir)).toEqual([]);
    expect(siblingsOfProject()).toEqual([]);
  }

  it("refuses `ndx prd export --out <path>`", () => {
    expectRejected(["prd", "export", "--out", "bundle.json", projectDir], "--out");
  });

  it("refuses `ndx prd import --in <path>`", () => {
    expectRejected(["prd", "import", "--in", "bundle.json", projectDir], "--in");
  });

  it("refuses `ndx prd export --item <ref>`", () => {
    expectRejected(
      ["prd", "export", "--item", "my-epic", "--out=bundle.json", projectDir],
      "--item",
    );
  });

  it("refuses `ndx prd export --format <name>`", () => {
    expectRejected(
      ["prd", "export", "--format", "narrative", "--out=prd.md", projectDir],
      "--format",
    );
  });

  it("still reports an unknown subcommand ahead of flag shape", () => {
    const { status, stdout, stderr } = runFail(["prd", "bogus", "--out", "x", projectDir]);
    expect(status).not.toBe(0);
    expect(stdout + stderr).toMatch(/Unknown 'ndx prd' subcommand: bogus/);
  });
});
