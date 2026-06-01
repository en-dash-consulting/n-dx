/**
 * Regression tests for target-repo README generation during `ndx init`.
 *
 * These tests pin the contract for the README generation feature:
 *   1. When no README variant exists, init writes README.md for the *target*
 *      repo — referencing its manifest name and free of n-dx-flavored
 *      strings.
 *   2. When any case-insensitive README variant exists (README, README.md,
 *      README.rst, readme.md, …), init never modifies the original and
 *      instead writes the synthesized content to README.proposed.md.
 *   3. README.proposed.md is overwritten on rerun; the original is still
 *      untouched.
 *
 * The tests run `ndx init` against synthetic target repos in throwaway
 * temp dirs so the assertions stay isolated from the n-dx repo itself.
 *
 * TDD ordering: this file is the regression contract for the sibling tasks
 * "Generate target-repo README.md …" and "Write README.proposed.md instead
 * of overwriting an existing README …". Until those tasks ship, the body
 * tests are expected to fail — that is the red phase. Do not skip them;
 * the sibling implementations are responsible for turning them green.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, readFile, writeFile, chmod, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const isWin = process.platform === "win32";
const PATH_SEP = isWin ? ";" : ":";

const CLI_PATH = join(import.meta.dirname, "../../packages/core/cli.js");

/**
 * Cross-platform fake provider binary so the init flow has *something* to
 * exec for codex without needing a real install.
 */
async function writeFakeBinary(filePath, { stdout = "", exitCode = 0 } = {}) {
  if (isWin) {
    const cmdPath = filePath + ".cmd";
    const lines = ["@echo off"];
    if (stdout) lines.push(`echo ${stdout}`);
    if (exitCode !== 0) lines.push(`exit /b ${exitCode}`);
    await writeFile(cmdPath, lines.join("\r\n") + "\r\n");
    return cmdPath;
  }
  const lines = ["#!/bin/sh"];
  if (stdout) lines.push(`echo '${stdout}'`);
  if (exitCode !== 0) lines.push(`exit ${exitCode}`);
  await writeFile(filePath, lines.join("\n") + "\n");
  await chmod(filePath, 0o755);
  return filePath;
}

function run(args, opts = {}) {
  return execFileSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: 25000,
    stdio: "pipe",
    ...opts,
  });
}

/**
 * Strings that must never appear in a target-repo README — these are
 * markers of n-dx's own documentation leaking into a user's project.
 */
const N_DX_FLAVOR_STRINGS = [
  "n-dx",
  "@n-dx/core",
  "AI-powered development toolkit",
];

function expectNoNdxFlavor(content) {
  for (const banned of N_DX_FLAVOR_STRINGS) {
    expect(content, `must not contain "${banned}"`).not.toContain(banned);
  }
}

describe("ndx init: target-repo README generation", () => {
  let tmpDir;
  let binDir;
  let initEnv;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-init-readme-"));
    binDir = await mkdtemp(join(tmpdir(), "ndx-init-readme-bin-"));
    await writeFakeBinary(join(binDir, "codex"), { stdout: "ok" });
    initEnv = {
      ...process.env,
      PATH: `${binDir}${PATH_SEP}${process.env.PATH ?? ""}`,
      // Short-circuit claude MCP registration so init does not depend on a
      // real claude install. See packages/core/claude-integration.js:306-320.
      CLAUDE_CLI_PATH: "/nonexistent/path/to/claude",
    };
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    await rm(binDir, { recursive: true, force: true });
  });

  async function writeManifest(projectName, description = "A synthetic project for ndx init regression tests") {
    await writeFile(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: projectName, version: "0.0.0", description }, null, 2) + "\n",
    );
  }

  function ndxInit() {
    return run(["init", "--provider=codex", "--no-claude", tmpDir], { env: initEnv });
  }

  it("writes README.md referencing the target project when no README exists", async () => {
    const projectName = "synthetic-target-app";
    await writeManifest(projectName);

    ndxInit();

    const readmePath = join(tmpDir, "README.md");
    expect(existsSync(readmePath)).toBe(true);
    const content = await readFile(readmePath, "utf-8");
    expect(content).toContain(projectName);
    expectNoNdxFlavor(content);
  });

  it("leaves an existing README.md byte-for-byte and writes README.proposed.md", async () => {
    await writeManifest("synthetic-target-app");
    const originalBytes = "# My Target Project\n\nHand-written content the user wants preserved.\n";
    const originalPath = join(tmpDir, "README.md");
    await writeFile(originalPath, originalBytes);
    const originalStat = await stat(originalPath);

    ndxInit();

    const after = await readFile(originalPath, "utf-8");
    expect(after).toBe(originalBytes);
    const afterStat = await stat(originalPath);
    expect(afterStat.size).toBe(originalStat.size);

    const proposedPath = join(tmpDir, "README.proposed.md");
    expect(existsSync(proposedPath)).toBe(true);
    const proposed = await readFile(proposedPath, "utf-8");
    expect(proposed.length).toBeGreaterThan(0);
    expect(proposed).not.toBe(originalBytes);
    expectNoNdxFlavor(proposed);
  });

  for (const variantName of ["README", "README.rst", "readme.md"]) {
    it(`uses the proposed-file path when ${variantName} exists`, async () => {
      await writeManifest("synthetic-target-app");
      const variantBytes = `Original ${variantName} contents — must remain untouched.\n`;
      const variantPath = join(tmpDir, variantName);
      await writeFile(variantPath, variantBytes);

      ndxInit();

      const after = await readFile(variantPath, "utf-8");
      expect(after).toBe(variantBytes);

      const proposedPath = join(tmpDir, "README.proposed.md");
      expect(existsSync(proposedPath)).toBe(true);
      // The proposed file must not be a verbatim copy of the existing
      // variant — it is supposed to carry synthesized content.
      const proposed = await readFile(proposedPath, "utf-8");
      expect(proposed).not.toBe(variantBytes);
      expectNoNdxFlavor(proposed);

      // A README.md sibling must not have been silently created when a
      // non-".md" variant (README, README.rst) was present.  Skip the
      // assertion when the variant itself IS a .md file (any case): on
      // case-insensitive filesystems readme.md and README.md alias to
      // the same inode, so the check would be meaningless.
      if (variantName.toLowerCase() !== "readme.md") {
        expect(existsSync(join(tmpDir, "README.md"))).toBe(false);
      }
    });
  }

  it("overwrites README.proposed.md on rerun but never touches the original README", async () => {
    await writeManifest("synthetic-target-app");
    const originalBytes = "# Locked README\n\nUser content, do not touch.\n";
    const originalPath = join(tmpDir, "README.md");
    await writeFile(originalPath, originalBytes);

    ndxInit();

    const proposedPath = join(tmpDir, "README.proposed.md");
    expect(existsSync(proposedPath)).toBe(true);

    // Replace the proposed file with a sentinel so we can confirm the
    // second init *rewrites* it (rather than appending or skipping).
    const sentinel = "SENTINEL-SHOULD-BE-OVERWRITTEN-ON-RERUN\n";
    await writeFile(proposedPath, sentinel);

    ndxInit();

    const afterOriginal = await readFile(originalPath, "utf-8");
    expect(afterOriginal).toBe(originalBytes);

    const afterProposed = await readFile(proposedPath, "utf-8");
    expect(afterProposed).not.toBe(sentinel);
    expect(afterProposed.length).toBeGreaterThan(0);
    expectNoNdxFlavor(afterProposed);
  });
});
