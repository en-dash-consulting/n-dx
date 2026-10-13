/**
 * `rex init` and the CLI error hints on a v2 tree: init must not scaffold a
 * v1 `prd_tree/` beside `product/`, and a missing-file error must not tell
 * the operator to run `n-dx init` on a project that already has a PRD.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CLI_ERROR_CODES } from "@n-dx/llm-client";
import { cmdInit } from "../../../src/cli/commands/init.js";
import { formatCLIError } from "../../../src/cli/errors.js";
import { PRD_TREE_DIRNAME } from "../../../src/store/index.js";
import { copyV2Fixture } from "../../helpers/v2-fixture.js";

describe("v2 layout guards in the CLI", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "rex-v2-cli-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmp, { recursive: true, force: true });
  });

  it("rex init on a tree with product/ creates no prd_tree/", async () => {
    const rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
    await cmdInit(tmp, {});
    expect(existsSync(join(rexDir, PRD_TREE_DIRNAME))).toBe(false);
    expect(existsSync(join(rexDir, "config.json"))).toBe(true);
  });

  it("rex init on a fresh project still scaffolds prd_tree/", async () => {
    await cmdInit(tmp, {});
    expect(existsSync(join(tmp, ".rex", PRD_TREE_DIRNAME, "index.md"))).toBe(true);
  });

  const enoent = (rexDir: string): Error =>
    new Error(`ENOENT: no such file or directory, open '${join(rexDir, "prd.json")}'`);

  it("a v2 tree never gets the 'n-dx init' hint", async () => {
    const rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
    const out = formatCLIError(enoent(rexDir));
    expect(out).not.toContain("n-dx init");
    expect(out).not.toContain(CLI_ERROR_CODES.NOT_INITIALIZED);
  });

  it("a v1 tree does not get the 'n-dx init' hint either", async () => {
    const rexDir = join(tmp, ".rex");
    await mkdir(join(rexDir, PRD_TREE_DIRNAME), { recursive: true });
    expect(formatCLIError(enoent(rexDir))).not.toContain("n-dx init");
  });

  it("a project with no PRD in either layout gets the hint", async () => {
    const rexDir = join(tmp, ".rex");
    await mkdir(rexDir, { recursive: true });
    const out = formatCLIError(enoent(rexDir));
    expect(out).toContain(CLI_ERROR_CODES.NOT_INITIALIZED);
    expect(out).toContain("n-dx init");
  });
});
