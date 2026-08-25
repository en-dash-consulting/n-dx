/**
 * Unit tests for resolveExistingDir — GitHub follow-up to the adversarial review.
 *
 * `resolveDir` scans an argument list backwards and returns the first token that
 * does not start with `-`. That is right inside a command handler, where the
 * args no longer contain the command. It is wrong in `main()`, where a
 * tool-delegation invocation still carries its subcommand:
 *
 *   ndx hench record --task=X --status=completed
 *     → command "hench", rest ["record", "--task=X", "--status=completed"]
 *     → every trailing arg is a flag, so the scan walks back to "record"
 *     → the project directory resolves to ./record
 *
 * Two things then go wrong: `checkProjectStaleness` looks for `.rex`, `.hench`
 * and `.sourcevision` under a path that does not exist and prints
 * "Project setup incomplete" in a fully initialized project, and
 * `loadProjectConfig` reads `.n-dx.json` from the same bogus path and silently
 * falls back to `{}`, so command timeouts and experimental flags do not apply.
 *
 * `resolveExistingDir` accepts a positional only when it really is a directory.
 * That covers the subcommand case and the "last positional is not a path at
 * all" case (`ndx rex add "some description"`) with one rule.
 *
 * @see packages/core/resolve-existing-dir.js
 * @see packages/core/cli.js — the main() call site
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveExistingDir } from "../../packages/core/resolve-existing-dir.js";

describe("resolveExistingDir()", () => {
  let base;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "resolve-existing-dir-"));
    mkdirSync(join(base, "realdir"), { recursive: true });
    writeFileSync(join(base, "afile.txt"), "not a directory\n");
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  // ── The regression this exists for ────────────────────────────────────────

  it("does not return a tool subcommand when every following arg is a flag", () => {
    const args = ["record", "--task=X", "--status=completed", "--title=T"];
    expect(resolveExistingDir(args, base)).toBe(base);
  });

  it("does not return a subcommand for a read-only delegation either", () => {
    expect(resolveExistingDir(["status", "--format=json"], base)).toBe(base);
  });

  it("does not return a free-text positional that is not a path", () => {
    // `ndx rex add "some description"` — the description is the last positional.
    expect(resolveExistingDir(["add", "some description"], base)).toBe(base);
  });

  it("does not return a positional that names a file rather than a directory", () => {
    expect(resolveExistingDir(["afile.txt"], base)).toBe(base);
  });

  // ── Explicit directories still win ───────────────────────────────────────

  it("returns an explicit relative directory", () => {
    expect(resolveExistingDir(["record", "--task=X", "realdir"], base)).toBe("realdir");
  });

  it("returns an explicit absolute directory", () => {
    const abs = join(base, "realdir");
    expect(resolveExistingDir(["--task=X", abs], base)).toBe(abs);
  });

  it('returns "." when passed explicitly', () => {
    expect(resolveExistingDir(["record", "--task=X", "."], base)).toBe(".");
  });

  it("prefers the last directory-valued positional", () => {
    expect(resolveExistingDir(["realdir", "."], base)).toBe(".");
  });

  // ── Degenerate input ─────────────────────────────────────────────────────

  it("falls back to the cwd for an empty argument list", () => {
    expect(resolveExistingDir([], base)).toBe(base);
  });

  it("falls back to the cwd when every arg is a flag", () => {
    expect(resolveExistingDir(["--format=json", "-q"], base)).toBe(base);
  });

  it("defaults its cwd argument to process.cwd()", () => {
    expect(resolveExistingDir([])).toBe(process.cwd());
  });
});
