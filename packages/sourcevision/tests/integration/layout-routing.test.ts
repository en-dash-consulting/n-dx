/**
 * SourceVision's file access follows the project's folder layout.
 *
 * The paths module made the analysis directory resolvable; this asserts the
 * call sites actually go through it. Every command below used to compose
 * `join(absDir, SV_DIR)` itself, so on a `.ndx` project `init` would have
 * written a second `.sourcevision/` beside the real one and `validate` would
 * have reported the analysis missing. The legacy half of each pair is the
 * regression guard: routing must not move a legacy project's files.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdInit } from "../../src/cli/commands/init.js";
import { cmdValidate } from "../../src/cli/commands/validate.js";
import { cmdReset } from "../../src/cli/commands/reset.js";
import { resolveSourcevisionPaths } from "../../src/paths.js";
import { hasSourcevision, analysisDirFor } from "../../src/export/iso-sources.js";
import { CLIError } from "../../src/cli/errors.js";

/** Where each layout keeps the analysis output, relative to the project root. */
const LAYOUTS = [
  { name: "legacy", container: null, svDir: ".sourcevision" },
  { name: "ndx", container: ".ndx", svDir: join(".ndx", "sourcevision") },
] as const;

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "sv-layout-routing-"));
  // init and validate narrate to stdout; the assertions are on the filesystem.
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(projectDir, { recursive: true, force: true });
});

describe.each(LAYOUTS)("sourcevision file access on the $name layout", ({ container, svDir }) => {
  beforeEach(() => {
    if (container) mkdirSync(join(projectDir, container), { recursive: true });
  });

  it("initializes into the layout's analysis directory", () => {
    cmdInit(projectDir);

    expect(resolveSourcevisionPaths(projectDir).svDir).toBe(join(projectDir, svDir));
    expect(existsSync(join(projectDir, svDir, "manifest.json"))).toBe(true);
  });

  it("does not create the other layout's directory", () => {
    cmdInit(projectDir);

    const unused =
      container === null ? join(projectDir, ".ndx") : join(projectDir, ".sourcevision");
    expect(existsSync(unused)).toBe(false);
  });

  it("finds the analysis it just wrote rather than reporting it missing", () => {
    cmdInit(projectDir);

    // `validate` throws only when it cannot find the analysis directory at all.
    // It still fails on the empty data files init writes, so the assertion is
    // on *which* failure: a schema complaint means the directory was found.
    expect(() => cmdValidate(projectDir)).not.toThrow(/Sourcevision directory not found/);
  });

  it("resets the analysis directory the layout actually uses", () => {
    cmdInit(projectDir);

    cmdReset(projectDir);

    expect(existsSync(join(projectDir, svDir, ".backup"))).toBe(true);
  });

  // `export/` bundles into the dependency-free standalone skill and cannot
  // import the resolver, so it carries its own copy of the rule. Two copies
  // drift silently; this is the per-layout check that they have not.
  it("agrees with the standalone iso bundle about where the analysis lives", () => {
    cmdInit(projectDir);

    expect(analysisDirFor(projectDir)).toBe(resolveSourcevisionPaths(projectDir).svDir);
  });
});

describe("sourcevision reports a missing analysis directory on either layout", () => {
  it.each(LAYOUTS)("throws for an uninitialized $name project", ({ container }) => {
    if (container) mkdirSync(join(projectDir, container), { recursive: true });

    expect(() => cmdValidate(projectDir)).toThrow(CLIError);
    expect(hasSourcevision(projectDir)).toBe(false);
  });
});
