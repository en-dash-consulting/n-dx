/**
 * `ndx export --deploy=github` is a remote write: it force-pushes the export to
 * `origin/n-dx-dashboard`. It must not happen without the operator seeing what
 * is about to be published. Non-TTY runs — CI, a dashboard-spawned child, a
 * script — have no one to ask, so they need `--yes`; without it the command
 * prints the manifest and stops before writing or pushing anything.
 *
 * These tests stop at the gate on purpose: the full export needs a built
 * viewer, which an e2e fixture should not depend on.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CLI_PATH,
  DEFAULT_TIMEOUT,
  createTmpDir,
  removeTmpDir,
  setupSourcevisionDir,
} from "./e2e-helpers.js";

const REMOTE = "https://example.invalid/acme/widgets.git";

function ndx(args, cwd) {
  return spawnSync("node", [CLI_PATH, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: DEFAULT_TIMEOUT,
    // stdin is a pipe, not a TTY — the shape of every unattended invocation.
    stdio: ["pipe", "pipe", "pipe"],
  });
}

describe("ndx export", () => {
  let dir;

  beforeEach(async () => {
    dir = await createTmpDir("ndx-export-e2e-");
    await setupSourcevisionDir(dir);
    await mkdir(join(dir, ".rex", "prd_tree", "an-epic"), { recursive: true });
    await writeFile(join(dir, ".rex", "prd_tree", "an-epic", "index.md"), "---\nid: e1\ntitle: An epic\nlevel: epic\nstatus: pending\n---\n");
    await mkdir(join(dir, ".hench", "runs"), { recursive: true });
    await writeFile(join(dir, ".hench", "runs", "run-1.json"), JSON.stringify({ id: "run-1", startedAt: "2026-01-01T00:00:00.000Z", status: "completed" }));
    const git = (a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
    git(["init", "-q"]);
    git(["remote", "add", "origin", REMOTE]);
  });

  afterEach(async () => {
    await removeTmpDir(dir);
  });

  describe("--deploy=github confirmation gate", () => {
    it("refuses without --yes when stdin is not a TTY, and pushes nothing", () => {
      const result = ndx(["export", "--deploy=github", dir], dir);

      expect(result.status).toBe(1);
      // The manifest names what would have been published.
      expect(result.stderr).toContain(REMOTE);
      expect(result.stderr).toContain("n-dx-dashboard");
      expect(result.stderr).toContain("1 hench run");
      expect(result.stderr).toMatch(/transcripts?:\s+(excluded|not included)/i);
      expect(result.stderr).toContain("--yes");
      // Nothing was written or pushed.
      expect(existsSync(join(dir, "ndx-export"))).toBe(false);
      const branches = execFileSync("git", ["branch", "--list", "n-dx-dashboard"], { cwd: dir, encoding: "utf-8" });
      expect(branches.trim()).toBe("");
    });

    it("passes the gate with --yes", () => {
      const result = ndx(["export", "--deploy=github", "--yes", dir], dir);

      // The export itself may still fail later in this fixture (no built
      // viewer, unreachable remote) — what matters is that the refusal did not
      // fire and the export started.
      expect(result.stderr).not.toContain("requires confirmation");
      expect(result.stdout).toContain("[export] generating static dashboard");
    });
  });

  describe("--help", () => {
    it("documents the transcript and confirmation flags and what is published", () => {
      const result = ndx(["export", "--help"], dir);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("--include-transcripts");
      expect(result.stdout).toContain("--yes");
      expect(result.stdout).toMatch(/not published/i);
    });
  });

  describe("output directory hygiene", () => {
    it("gitignores the default out-dir when export runs inside the project", async () => {
      // Even a run that stops at the gate must not leave `ndx-export/`
      // committable — the gitignore entry is written before any output is.
      ndx(["export", "--deploy=github", "--yes", dir], dir);
      const ignore = await readFile(join(dir, ".gitignore"), "utf-8").catch(() => "");
      expect(ignore.split("\n")).toContain("ndx-export/");
    });
  });
});
