/**
 * Committing a settings change under fail-forward mode.
 *
 * The important cases are the ones where it must do nothing: the mode off, a
 * save that changed nothing, and a path outside the project. A settings helper
 * that commits when it should not is how an automatic mode starts sweeping up
 * work nobody asked it to touch.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync, execFileSync } from "node:child_process";

import {
  commitSettingsChange,
  settingsSubject,
} from "../../../src/server/settings-commit.js";

function git(dir: string, args: string[]): string {
  return execFileSync("git", args, { cwd: dir, encoding: "utf-8" });
}

function initRepo(dir: string): void {
  execSync("git init", { cwd: dir, stdio: "ignore" });
  execSync("git config user.email test@test.com", { cwd: dir, stdio: "ignore" });
  execSync("git config user.name Test", { cwd: dir, stdio: "ignore" });
  execSync("git config core.autocrlf false", { cwd: dir, stdio: "ignore" });
  execSync("git checkout -b main", { cwd: dir, stdio: "ignore" });
}

describe("commitSettingsChange", () => {
  let dir: string;
  let configPath: string;

  /** Write `.n-dx.json`, optionally turning fail-forward on. */
  function writeConfig(failForward: boolean, extra: Record<string, unknown> = {}): void {
    writeFileSync(
      configPath,
      JSON.stringify({ features: { git: { failForward } }, ...extra }, null, 2) + "\n",
      "utf-8",
    );
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "settings-commit-"));
    configPath = join(dir, ".n-dx.json");
    initRepo(dir);
    writeFileSync(join(dir, "README.md"), "x\n");
    writeConfig(false);
    execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], { cwd: dir, stdio: "ignore" });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("does nothing while the mode is off", async () => {
    writeConfig(false, { web: { port: 4000 } });
    const before = git(dir, ["rev-parse", "HEAD"]).trim();

    expect(await commitSettingsChange(dir, configPath, "project")).toBe(false);
    expect(git(dir, ["rev-parse", "HEAD"]).trim()).toBe(before);
    // The change is still on disk, waiting in the git panel.
    expect(git(dir, ["status", "--porcelain"])).toContain(".n-dx.json");
  });

  it("commits the config when the mode is on", async () => {
    writeConfig(true, { web: { port: 4000 } });

    expect(await commitSettingsChange(dir, configPath, "project")).toBe(true);
    expect(git(dir, ["log", "-1", "--pretty=%s"]).trim()).toBe(settingsSubject("project"));
    expect(git(dir, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("uses a constant subject per settings area", async () => {
    const areas = ["project", "rex", "hench", "llm", "features", "cli"] as const;
    const subjects = areas.map((a) => settingsSubject(a));
    // Each area is distinguishable in the log, and none is generated.
    expect(new Set(subjects).size).toBe(areas.length);
    for (const s of subjects) expect(s).toMatch(/^chore\(settings\): /);
  });

  it("does nothing when the write changed nothing", async () => {
    // Re-saving identical values is the common case and should not produce an
    // empty commit on every visit to the settings page.
    writeConfig(true);
    expect(await commitSettingsChange(dir, configPath, "project")).toBe(true);
    const after = git(dir, ["rev-parse", "HEAD"]).trim();

    expect(await commitSettingsChange(dir, configPath, "project")).toBe(false);
    expect(git(dir, ["rev-parse", "HEAD"]).trim()).toBe(after);
  });

  it("commits only the config, leaving other work alone", async () => {
    writeConfig(true, { web: { port: 4000 } });
    writeFileSync(join(dir, "README.md"), "my own edit\n");
    writeFileSync(join(dir, "scratch.txt"), "untracked\n");

    expect(await commitSettingsChange(dir, configPath, "project")).toBe(true);

    const files = git(dir, ["show", "--name-only", "--pretty=", "HEAD"]);
    expect(files).toContain(".n-dx.json");
    expect(files).not.toContain("README.md");

    const status = git(dir, ["status", "--porcelain"]);
    expect(status).toContain("README.md");
    expect(status).toContain("scratch.txt");
  });

  it("leaves work the operator had already staged staged", async () => {
    writeConfig(true, { web: { port: 4000 } });
    writeFileSync(join(dir, "README.md"), "staged by hand\n");
    git(dir, ["add", "README.md"]);

    expect(await commitSettingsChange(dir, configPath, "project")).toBe(true);
    expect(git(dir, ["show", "--name-only", "--pretty=", "HEAD"])).not.toContain("README.md");
    expect(git(dir, ["diff", "--cached", "--name-only"])).toContain("README.md");
  });

  it("refuses a path outside the project", async () => {
    writeConfig(true, { web: { port: 4000 } });
    const outside = join(tmpdir(), "somewhere-else.json");
    expect(await commitSettingsChange(dir, outside, "project")).toBe(false);
  });

  it("carries the fail-forward producer trailer", async () => {
    writeConfig(true, { web: { port: 4000 } });
    await commitSettingsChange(dir, configPath, "features");
    const body = git(dir, ["log", "-1", "--pretty=%B"]);
    expect(body).toContain("N-DX: fail-forward (settings)");
    expect(body).toContain("Co-Authored-By:");
  });

  it("reports false rather than throwing outside a git repository", async () => {
    const bare = mkdtempSync(join(tmpdir(), "settings-commit-nogit-"));
    try {
      mkdirSync(join(bare, "sub"), { recursive: true });
      const p = join(bare, ".n-dx.json");
      writeFileSync(p, JSON.stringify({ features: { git: { failForward: true } } }), "utf-8");
      expect(await commitSettingsChange(bare, p, "project")).toBe(false);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
