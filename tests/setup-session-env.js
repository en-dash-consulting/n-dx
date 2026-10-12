/**
 * Vitest setupFile — hide the ambient Claude Code session from the test suite.
 *
 * WHY: `hench record` reads token usage from the current Claude Code session's
 * transcript, discovered through `CLAUDE_CODE_SESSION_ID`. Claude Code exports
 * that variable to every tool it runs — including `pnpm test`. So a suite run
 * from inside a Claude Code session picked up a real, ever-growing transcript,
 * and any test touching the record path asserted against live numbers:
 *
 *   expected 'claude-opus-5' to be 'claude-sonnet-4-6'
 *
 * The model came from the ambient session rather than from the config the test
 * had just written. Token counts would have been worse — they change between
 * runs, so the failure would have looked like a flake rather than an environment
 * leak. CI never sets the variable, so CI stayed green and only humans running
 * the suite inside Claude Code (or an agent doing the same) saw it.
 *
 * This is the same shape as tests/setup-color-env.js, for the same reason: an
 * ambient variable the production code is right to consult, and which a test must
 * therefore control rather than inherit. Tests that want the transcript path
 * exercise it explicitly with `--transcript=<fixture>`, which is deterministic;
 * tests that want the no-session path now get it reliably.
 *
 * WHY A setupFile RATHER THAN globalSetup: setupFiles run inside each worker
 * before that worker loads any test module, so the variable is gone before any
 * code can read it. globalSetup runs in a different process and would not affect
 * the workers' environment.
 *
 * `CLAUDE_CONFIG_DIR` is cleared alongside it: it relocates the transcript tree,
 * so leaving it set would point a fixture-driven lookup at a real one.
 */

delete process.env.CLAUDE_CODE_SESSION_ID;
delete process.env.CLAUDE_CONFIG_DIR;

// ---------------------------------------------------------------------------
// One git config for every fixture repository
// ---------------------------------------------------------------------------
//
// WHY: fixtures build real git repositories in temp dirs, and each one needs
// an identity so commits succeed, LF line endings so byte-exact assertions
// hold on Windows, and signing off so a developer's `commit.gpgsign=true`
// cannot fail every fixture commit. Before this file, each fixture set those
// per repository: `git init` followed by two to five `git config` spawns, in
// 38 test files plus the hench helper, inside beforeEach hooks that run per
// test. A git spawn is cheap on Linux and about ten times dearer on the
// Windows CI runner, which is where those thousands of spawns showed up as
// minutes (run 38193308009).
//
// Git reads `GIT_CONFIG_GLOBAL` in place of `~/.gitconfig` (git 2.32+), and
// the setting is inherited by every process this worker spawns — the test's
// own `git`, and the CLIs the e2e tests run, which spawn `git` in turn. So
// one file written here covers every fixture at once, and a fixture that sets
// a different identity at local level still wins, as local config always
// does. The system config is left in place: Git for Windows ships settings
// there (fscache, credential helper) that are not this file's business, and
// the one that matters, `core.autocrlf=true`, is overridden below.
//
// `core.hooksPath` points at an empty directory so a global hooks path on the
// developer's machine (husky-style installs, `core.hooksPath` in their own
// gitconfig) cannot run inside a fixture. No test installs a real hook; the
// ones that test hook failures mock the git boundary.
//
// Written to a stable path and only when the content differs, through a
// rename, so the thousands of worker processes a run forks do not each leave
// a file behind and do not race each other writing the same one.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const gitTestDir = join(tmpdir(), "ndx-test-git");
const gitHooksDir = join(gitTestDir, "no-hooks");
const gitConfigPath = join(gitTestDir, "gitconfig");

// Forward slashes: git parses backslashes in config values as escapes.
const hooksPathValue = gitHooksDir.split("\\").join("/");
const gitConfigContent = [
  "# Written by tests/setup-session-env.js for every vitest worker. Safe to delete.",
  "[user]",
  "\tname = Test",
  "\temail = test@test.com",
  "[core]",
  "\tautocrlf = false",
  "\teol = lf",
  `\thooksPath = ${hooksPathValue}`,
  "[commit]",
  "\tgpgsign = false",
  "",
].join("\n");

mkdirSync(gitHooksDir, { recursive: true });
let current = null;
try {
  current = readFileSync(gitConfigPath, "utf-8");
} catch {
  // Missing on the first worker of a fresh machine; written below.
}
if (current !== gitConfigContent) {
  const staging = `${gitConfigPath}.${process.pid}.tmp`;
  writeFileSync(staging, gitConfigContent, "utf-8");
  try {
    renameSync(staging, gitConfigPath);
  } catch (err) {
    // Another worker renamed its identical copy in between; theirs is fine.
    if (!existsSync(gitConfigPath)) throw err;
  }
}

process.env.GIT_CONFIG_GLOBAL = gitConfigPath;
