# Shell-spawning tests

Every test site that runs a shell as a real process, and how it is guarded.

`sh` is not on PATH in a stock Windows shell. It ships with Git for Windows
(`C:\Program Files\Git\usr\bin\sh.exe`), which Git Bash exposes and
PowerShell/cmd.exe do not. Before the guards below, the same commit passed from
Git Bash and failed from PowerShell — and none of the failure messages mentioned
a shell. Two of those investigations were opened as suspected regressions during
a merge.

The `sh` indirection is deliberate everywhere it appears and must not be replaced
by spawning `node` directly. libuv assigns every non-detached child it spawns on
Windows to a global job object, so a node-spawns-node tree reaps itself when the
parent dies and the test passes without proving anything — an earlier version of
the orphan test was vacuous for exactly that reason.

**Changed 2026-09-09.** The product no longer hard-requires `sh`.
`execShellCmd` (`packages/llm-client/src/exec.ts`) now resolves a shell the
host actually has — `sh` where `sh` is on PATH, `cmd.exe /d /s /c` otherwise —
via `resolveShellInvocation`. It used to spawn `sh` unconditionally, which on a
stock Windows PATH failed with ENOENT ~2 ms in and, because a failed spawn
reports as `exitCode: 1` with empty output, was read as a command that ran and
failed: the hench test gate aborted otherwise-good `ndx work` runs with
`0/0 package(s) failed`. So a missing `sh` no longer means hench's shell-backed
tools are broken on that machine; it means only that POSIX command *syntax*
(pipes into `head`, single-quoted globs, `&&` chains written for sh) is
unavailable. Guards below that exist for a test's own POSIX command string are
still correct; guards that existed because the tool could not spawn at all are
not.

## Two kinds of dependency

**Scaffolding.** The shell stands in for a non-libuv intermediate so the process
tree is worth testing. A missing shell is a test-environment problem, and the
test skips.

**Under test.** hench's tools shell out on *every* platform, so the command
string a test hands them is executed for real. Since the 2026-09-09 change above
the tool itself runs anywhere, but a command written in POSIX syntax still needs
a POSIX shell — `echo hello | head` has no `head` under cmd.exe. Those tests
skip, and the skip message says which product capability went unverified: not
"shelling out" any more, but "shelling out to a POSIX shell".

## Inventory

Counts are per test case. Measured 2026-08-20 by running each file from
PowerShell (no `sh`) and from Git Bash (`sh` at `/usr/bin/sh`), same commit.

| Site | Kind | Cases needing `sh` | Before | Guard |
|------|------|-----|--------|-------|
| `tests/e2e/stop-orphan-children.test.js` | scaffolding | 1 of 2 | 1 false failure (`expected false to be true` after a 5s wait) | `itNeedsPosixShell` + spawn error surfaced |
| `tests/integration/exec-interrupt-forwarding.test.js` | scaffolding | 2 of 3 | 1 false failure, 10s burn | `describeNeedsPosixShell` (the listener-registration case spawns node directly and runs ungated on every host) |
| `packages/llm-client/tests/integration/exec-timeout-tree-kill.test.ts` | scaffolding | 6 of 6 | 4 false failures + **2 false passes** | `describeEachNeedsPosixShell` |
| `packages/hench/tests/unit/tools/shell.test.ts` | under test | 14 of 34 | 13 false failures + **1 false pass** | `describeNeedsPosixShell` ×4, `itNeedsPosixShell` ×2 |
| `packages/hench/tests/unit/tools/test-runner.test.ts` | under test | 4 of 58 | 2 false failures + **2 false passes** | `itNeedsPosixShell` ×4 |
| `packages/hench/tests/unit/tools/git.test.ts` | under test | 7 of 25 | 7 false failures (`expected 'Exit code: 1' to contain 'branch'` etc.) | `itNeedsPosixShell` ×7 |

Guards removed 2026-09-09: `packages/hench/tests/integration/gate-changed-files.test.ts`
had 2 cases guarded because a failed `sh` launch made the gate's `ran` false.
That was the bug, not the environment — its command is `exit 0`, a builtin in
both shells — so both cases now run on every host and are the coverage that
catches a gate which cannot launch its shell. The remaining `sh` guards in the
table above are for POSIX command syntax, which is a real environment limit.

Totals: 33 guarded cases across 5 files — 26 were failing, 5 were passing
vacuously, and 2 are the POSIX-only interrupt cases that skip on Windows for a
separate, already-stated reason. (The `git.test.ts` row was measured 2026-08-25;
it was missed by the original hand audit, which is why the completeness scan
below now exists.)

The false passes matter more than the false failures. A case asserting "nothing
was written after the timeout" is trivially satisfied when nothing ever ran, and
`reports exit code on failure without output` is satisfied by a spawn that
failed to launch. Those were green on a machine where the behaviour was never
exercised.

## Sites that need no guard

| Site | Why it is safe |
|------|----------------|
| `tests/e2e/cli-init.test.js:116` | Selects `isWin ? "cmd.exe" : "sh"` — already platform-branched |
| `tests/e2e/pair-programming-timeout-tree-kill.test.js`, `tests/integration/pair-programming.test.js` | Go through `runShellTestCommand`, which uses `shell: true` — Node picks `ComSpec`/cmd.exe on Windows, so PATH is not consulted for `sh` |
| `tests/e2e/published-imports-resolved.test.js:60` | `shell: true`, as above |
| `packages/hench/tests/unit/tools/go-test-runner.test.ts` | Passes from PowerShell — verified, no shell-dependent assertion |
| `runTestGate` cases in `test-runner.test.ts` | Assert shape only (`typeof passed === "boolean"`, `duration >= 0`), so they neither fail nor pass *because of* the shell. Weak, but not shell-dependent |
| `packages/hench/tests/integration/test-gate.test.ts` | Same shape-only rationale as the `runTestGate` cases above — asserts result structure, never shell output |
| `packages/hench/tests/integration/gate-changed-files.test.ts` (all 3 cases) | One returns before any spawn (empty changed set); the other two shell out with `exit 0`, a builtin in both `sh` and `cmd.exe`. Guards removed 2026-09-09 — see above |
| 4 cases in `packages/hench/tests/unit/tools/git.test.ts` (`runs git branch`, `properly handles quoted args…`, `handles args with special characters…`, `records git operations in policy audit log`) | Assert shape (`typeof result === "string"`) or guard bookkeeping that happens before the spawn — verified passing from PowerShell without `sh` |
| Files writing `#!/bin/sh` shims (`cli-auth`, `cli-config`, `cli-stale-check`, `codex-integration`, `assistant-parity-smoke`, `llm-client/tests/helpers/fake-cli.ts`) | Write a script; execution is either POSIX-only (where `/bin/sh` exists by definition) or routed through cmd.exe on Windows |
| Unit tests asserting `cmd === "sh"` (`llm-client/tests/unit/exec.test.ts:270`, `hench/tests/unit/process/exec.test.ts:124`, `hench/tests/unit/agent/completion.test.ts:320`) | Inspect a fake spawn's arguments; no process is created |

## Helpers

One per suite boundary, because a package's tests do not reach into the
repo-root test tree. All three delegate to the same production probe,
`isExecutableOnPath` (`packages/llm-client/src/exec.ts`), so tests answer "can
spawn find this?" the way the shipped code does. Only the wording differs, since
what a missing shell *means* differs by suite.

| Helper | Serves |
|--------|--------|
| `tests/helpers/posix-shell.js` | Root suite (`tests/**`) |
| `packages/llm-client/tests/helpers/posix-shell.ts` | llm-client package suite |
| `packages/hench/tests/helpers/posix-shell.ts` | hench package suite (imports the probe through `llm-gateway`) |

Each skips rather than fails: a red suite that means "wrong shell" teaches
developers to ignore red. The reason travels in the suite/case name so the
reporter states it, and a fuller explanation with the remedy is printed once per
process.

## Adding a test that spawns a shell

1. Use one of the helpers above — do not call `spawn("sh", …)` unguarded.
2. Do not discard the spawn's own error. `stdio: "ignore"` is about the child's
   output; a failed launch must stay observable, and when the spawn happens in a
   helper process, record it somewhere the assertion can read it back (see
   `stop-orphan-children.test.js`).
3. Check whether your assertion can pass *without* the shell. If it can, it is a
   false pass waiting to happen — guard it even though it is green today.
4. Add a row here. This step is enforced:
   `tests/e2e/shell-spawn-inventory-policy.test.js` scans every test file for
   real shell spawns (direct `spawn("sh", …)` or an unmocked import of a
   shell-backed hench tool module) and fails when a flagged file has no entry
   in this document.
