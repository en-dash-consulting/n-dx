/**
 * Branch guard wiring: verifies that every whole-tree rewrite command
 * (reshape, reorganize, prune, import-bundle --replace, and the migrate-*
 * commands) refuses to run on a feature branch unless `--allow-on-branch`
 * is passed, and that the default branch is unaffected.
 *
 * Each command is invoked with just enough setup to reach its guard check
 * (which runs before any store access), so these tests don't need LLM
 * mocking. Past the guard, commands hit their normal "nothing to do here"
 * paths — which prove the guard did *not* fire, without needing full PRD
 * fixtures.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { cmdReshape } from "../../src/cli/commands/reshape.js";
import { cmdReorganize } from "../../src/cli/commands/reorganize.js";
import { cmdPrune } from "../../src/cli/commands/prune.js";
import { cmdImportBundle } from "../../src/cli/commands/import-bundle.js";
import { cmdMigrateToFolderTree } from "../../src/cli/commands/migrate-to-folder-tree.js";
import { cmdMigrateSlugs } from "../../src/cli/commands/migrate-slugs.js";
import { cmdMigrateFolderTreeFilenames } from "../../src/cli/commands/migrate-folder-tree-filenames.js";
import { cmdMigrateToMd } from "../../src/cli/commands/migrate-to-md.js";
import { writePRD } from "../helpers/rex-dir-test-support.js";

const FEATURE_BRANCH = "feature/branch-guard-test";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function initRepoOnMain(dir: string): void {
  git(dir, "init", "--initial-branch=main");
  git(dir, "config", "user.email", "test@test.com");
  git(dir, "config", "user.name", "Test");
  git(dir, "commit", "--allow-empty", "-m", "init");
}

/** Run a guarded command and report whether the branch guard is what stopped it. */
async function runGuarded(fn: () => Promise<void>): Promise<{ blockedByGuard: boolean; message?: string }> {
  try {
    await fn();
    return { blockedByGuard: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // CLIError keeps the flag suggestion separate from the message — combine
    // both so assertions can check for the branch name and the flag either way.
    const suggestion = (err as { suggestion?: string })?.suggestion ?? "";
    const combined = `${message}\n${suggestion}`;
    return { blockedByGuard: /not the default branch/.test(message), message: combined };
  }
}

describe("branch guard: whole-tree rewrite commands", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "rex-branch-guard-int-"));
    writePRD(dir, { schema: "rex/v1", title: "PRD", items: [] });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reshape refuses on a feature branch, names the branch and flag, and proceeds with --allow-on-branch", async () => {
    initRepoOnMain(dir);
    git(dir, "checkout", "-b", FEATURE_BRANCH);

    const blocked = await runGuarded(() => cmdReshape(dir, {}));
    expect(blocked.blockedByGuard).toBe(true);
    expect(blocked.message).toContain(FEATURE_BRANCH);
    expect(blocked.message).toContain("--allow-on-branch");

    const allowed = await runGuarded(() => cmdReshape(dir, { "allow-on-branch": "true" }));
    expect(allowed.blockedByGuard).toBe(false);
  });

  it("reshape behaves as today on the default branch", async () => {
    initRepoOnMain(dir);
    const result = await runGuarded(() => cmdReshape(dir, {}));
    expect(result.blockedByGuard).toBe(false);
  });

  it("reorganize refuses on a feature branch and proceeds with --allow-on-branch", async () => {
    initRepoOnMain(dir);
    git(dir, "checkout", "-b", FEATURE_BRANCH);

    const blocked = await runGuarded(() => cmdReorganize(dir, { accept: "true" }));
    expect(blocked.blockedByGuard).toBe(true);
    expect(blocked.message).toContain(FEATURE_BRANCH);
    expect(blocked.message).toContain("--allow-on-branch");

    const allowed = await runGuarded(() => cmdReorganize(dir, { accept: "true", "allow-on-branch": "true" }));
    expect(allowed.blockedByGuard).toBe(false);
  });

  it("reorganize behaves as today on the default branch", async () => {
    initRepoOnMain(dir);
    const result = await runGuarded(() => cmdReorganize(dir, {}));
    expect(result.blockedByGuard).toBe(false);
  });

  it("prune (including --smart) refuses on a feature branch and proceeds with --allow-on-branch", async () => {
    initRepoOnMain(dir);
    git(dir, "checkout", "-b", FEATURE_BRANCH);

    const blocked = await runGuarded(() => cmdPrune(dir, {}));
    expect(blocked.blockedByGuard).toBe(true);
    expect(blocked.message).toContain(FEATURE_BRANCH);
    expect(blocked.message).toContain("--allow-on-branch");

    const blockedSmart = await runGuarded(() => cmdPrune(dir, { smart: "true" }));
    expect(blockedSmart.blockedByGuard).toBe(true);

    const allowed = await runGuarded(() => cmdPrune(dir, { "allow-on-branch": "true" }));
    expect(allowed.blockedByGuard).toBe(false);
  });

  it("prune behaves as today on the default branch", async () => {
    initRepoOnMain(dir);
    const result = await runGuarded(() => cmdPrune(dir, {}));
    expect(result.blockedByGuard).toBe(false);
  });

  it("read-only previews are not guarded on a feature branch", async () => {
    initRepoOnMain(dir);
    git(dir, "checkout", "-b", FEATURE_BRANCH);
    for (const run of [
      () => cmdReshape(dir, { "dry-run": "true" }),
      () => cmdPrune(dir, { "dry-run": "true" }),
      () => cmdReorganize(dir, {}),
    ]) {
      expect((await runGuarded(run)).blockedByGuard).toBe(false);
    }
  });

  it("import-bundle --replace refuses on a feature branch and proceeds with --allow-on-branch", async () => {
    initRepoOnMain(dir);
    git(dir, "checkout", "-b", FEATURE_BRANCH);
    const bundlePath = join(dir, "nonexistent-bundle.json");

    const blocked = await runGuarded(() =>
      cmdImportBundle(dir, { in: bundlePath, replace: "true" }),
    );
    expect(blocked.blockedByGuard).toBe(true);
    expect(blocked.message).toContain(FEATURE_BRANCH);
    expect(blocked.message).toContain("--allow-on-branch");

    const allowed = await runGuarded(() =>
      cmdImportBundle(dir, { in: bundlePath, replace: "true", "allow-on-branch": "true" }),
    );
    expect(allowed.blockedByGuard).toBe(false);
  });

  it("import-bundle merge mode (no --replace) is unaffected by the branch guard", async () => {
    initRepoOnMain(dir);
    git(dir, "checkout", "-b", FEATURE_BRANCH);
    const bundlePath = join(dir, "nonexistent-bundle.json");

    const result = await runGuarded(() => cmdImportBundle(dir, { in: bundlePath }));
    expect(result.blockedByGuard).toBe(false);
  });

  it("import-bundle --replace behaves as today on the default branch", async () => {
    initRepoOnMain(dir);
    const bundlePath = join(dir, "nonexistent-bundle.json");
    const result = await runGuarded(() => cmdImportBundle(dir, { in: bundlePath, replace: "true" }));
    expect(result.blockedByGuard).toBe(false);
  });

  it("migrate-to-folder-tree refuses on a feature branch and proceeds with --allow-on-branch", async () => {
    initRepoOnMain(dir);
    git(dir, "checkout", "-b", FEATURE_BRANCH);

    const blocked = await runGuarded(() => cmdMigrateToFolderTree(dir, {}));
    expect(blocked.blockedByGuard).toBe(true);
    expect(blocked.message).toContain(FEATURE_BRANCH);
    expect(blocked.message).toContain("--allow-on-branch");

    const allowed = await runGuarded(() =>
      cmdMigrateToFolderTree(dir, { "allow-on-branch": "true" }),
    );
    expect(allowed.blockedByGuard).toBe(false);
  });

  it("migrate-to-folder-tree behaves as today on the default branch", async () => {
    initRepoOnMain(dir);
    const result = await runGuarded(() => cmdMigrateToFolderTree(dir, {}));
    expect(result.blockedByGuard).toBe(false);
  });

  it("migrate-slugs refuses on a feature branch and proceeds with --allow-on-branch", async () => {
    initRepoOnMain(dir);
    git(dir, "checkout", "-b", FEATURE_BRANCH);

    const blocked = await runGuarded(() => cmdMigrateSlugs(dir, {}));
    expect(blocked.blockedByGuard).toBe(true);
    expect(blocked.message).toContain(FEATURE_BRANCH);
    expect(blocked.message).toContain("--allow-on-branch");

    const allowed = await runGuarded(() => cmdMigrateSlugs(dir, { "allow-on-branch": "true" }));
    expect(allowed.blockedByGuard).toBe(false);
  });

  it("migrate-slugs behaves as today on the default branch", async () => {
    initRepoOnMain(dir);
    const result = await runGuarded(() => cmdMigrateSlugs(dir, {}));
    expect(result.blockedByGuard).toBe(false);
  });

  it("migrate-folder-tree-filenames refuses on a feature branch and proceeds with --allow-on-branch", async () => {
    initRepoOnMain(dir);
    git(dir, "checkout", "-b", FEATURE_BRANCH);

    const blocked = await runGuarded(() => cmdMigrateFolderTreeFilenames(dir, {}));
    expect(blocked.blockedByGuard).toBe(true);
    expect(blocked.message).toContain(FEATURE_BRANCH);
    expect(blocked.message).toContain("--allow-on-branch");

    const allowed = await runGuarded(() =>
      cmdMigrateFolderTreeFilenames(dir, { "allow-on-branch": "true" }),
    );
    expect(allowed.blockedByGuard).toBe(false);
  });

  it("migrate-folder-tree-filenames behaves as today on the default branch", async () => {
    initRepoOnMain(dir);
    const result = await runGuarded(() => cmdMigrateFolderTreeFilenames(dir, {}));
    expect(result.blockedByGuard).toBe(false);
  });

  it("migrate-to-md refuses on a feature branch and proceeds with --allow-on-branch", async () => {
    initRepoOnMain(dir);
    git(dir, "checkout", "-b", FEATURE_BRANCH);

    const blocked = await runGuarded(() => cmdMigrateToMd(dir));
    expect(blocked.blockedByGuard).toBe(true);
    expect(blocked.message).toContain(FEATURE_BRANCH);
    expect(blocked.message).toContain("--allow-on-branch");

    const allowed = await runGuarded(() => cmdMigrateToMd(dir, { "allow-on-branch": "true" }));
    expect(allowed.blockedByGuard).toBe(false);
  });

  it("migrate-to-md behaves as today on the default branch", async () => {
    initRepoOnMain(dir);
    const result = await runGuarded(() => cmdMigrateToMd(dir));
    expect(result.blockedByGuard).toBe(false);
  });

  it("falls back to main/master when origin/HEAD names a pruned ref", async () => {
    initRepoOnMain(dir);
    // A clone whose upstream default branch was renamed and pruned locally:
    // origin/HEAD still names the old, now-absent remote-tracking ref.
    git(dir, "remote", "add", "origin", "https://example.invalid/repo.git");
    git(dir, "update-ref", "refs/remotes/origin/master", "HEAD");
    git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master");
    git(dir, "update-ref", "-d", "refs/remotes/origin/master");

    const result = await runGuarded(() => cmdReshape(dir, {}));
    expect(result.blockedByGuard).toBe(false);
  });

  it("does not block when the project directory has no resolvable git branch", async () => {
    // No git init at all — resolveGitBranch falls back to "unknown", which
    // the guard treats as safe (most test fixtures and some real projects
    // are not git repos).
    const result = await runGuarded(() => cmdReshape(dir, {}));
    expect(result.blockedByGuard).toBe(false);
  });
});

