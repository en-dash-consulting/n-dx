---
id: "3181cbc2-b8b7-45cf-98cc-abccadfe7352"
type: "capability"
title: "Execute the test suite on Windows and macOS in CI"
slug: "execute-the-test-suite-on-windows-and"
statement: "CI runs the unit, integration and root e2e test suites on windows-latest and macos-latest as well as ubuntu, so a regression that shows up on only one OS fails the build."
criteria: [{"id":"c1","text":"CI shall run the per-package suites and the root e2e/integration suite on windows-latest and macos-latest."},{"id":"c2","text":"If a change breaks a Windows-only code path, CI shall fail the Windows job."},{"id":"c3","text":"The Windows CI job shall run the per-package suites through scripts/run-all-tests.mjs packages."},{"id":"c4","text":"When one package's suite fails, the per-package CI step shall still run the remaining packages and shall report the step as failed."},{"id":"c5","text":"CI shall keep the smoke-parity job, which collects CLI smoke output on macOS and Windows and diffs the two collected artifacts."},{"id":"c6","text":"While a test case is known to fail on an OS, the test suite shall quarantine it with explicit tracking rather than skipping it silently or deleting it."},{"id":"c7","text":"When a POSIX child process times out, llm-client shall kill its whole process group, grandchildren included, not only the shell."},{"id":"c8","text":"On POSIX, hench's toCommandPath shall leave backslashes in a path unchanged, because a backslash is a legal POSIX filename character."},{"id":"c9","text":"When the platform is Windows, buildClaudeCliArgs shall leave out the --system-prompt flag and send the system prompt on stdin, followed by a --- separator and then the task prompt."},{"id":"c10","text":"When the platform is Windows, buildClaudeCliArgs shall pass the allowed tools as a single comma-joined argument."},{"id":"c11","text":"When the platform is not Windows, buildClaudeCliArgs shall pass the system prompt through --system-prompt and each allowed tool as a separate argv entry."},{"id":"c12","text":"buildClaudeCliArgs shall accept an injected platform value, so that either platform's argument shape can be produced on any host OS."},{"id":"c13","text":"hench's findRelevantTests shall normalize each candidate test path and check that it exists on the filesystem, so test discovery works with OS-native path separators."},{"id":"c14","text":"When a run file is rewritten with content of the same length within one filesystem timestamp tick, the incremental task usage aggregator shall detect the file as changed and update the aggregation."}]
requirements: [{"id":"3181cbc2-b8b7-45cf-98cc-abccadfe7352:c7","title":"When a POSIX child process times out, llm-client shall kill its whole process group, grandchildren included, not only the shell","description":"Linked to: tests/e2e/pair-programming-timeout-tree-kill.test.js","category":"technical","validationType":"automated","acceptanceCriteria":["When a POSIX child process times out, llm-client shall kill its whole process group, grandchildren included, not only the shell."]}]
tags:
  - "cross-os"
  - "ci"
  - "testing"
  - "windows"
  - "macos"
source: "exploration-2026-08-17"
priority: "high"
---

The root enabler for every other parity item: no automated test executes on Windows or macOS today.

.github/workflows/ci.yml as it stands:
- `validate` (ubuntu-latest) — build, typecheck, docs, pr-check, `pnpm -r run test`, then `node scripts/run-vitest-bind-aware.mjs root` for the root e2e/integration suites, changeset checks
- `smoke-macos` (macos-latest) — install, build, `scripts/cli-smoke-parity.mjs collect` ONLY
- `smoke-windows` (windows-latest) — install, build, `scripts/cli-smoke-parity.mjs collect` ONLY
- `smoke-parity` (ubuntu) — diffs the two collected artifacts

The smoke collector covers 8 read-only cases (version-text, version-json, unknown-command, typo-suggestion, help-rex, plan-help, status-missing-rex, status-json). It exercises no mutation, no spawn of a vendor CLI, no init, no MCP, no server. Consequence: win-spawn.js, the quoting twin, child-lifecycle's Windows branch, and every `isWin` conditional in the codebase ship having never been executed by a test on their target OS. It is also why 10 Windows-skipped test cases went unnoticed as a coverage gap — on ubuntu they simply run, and on Windows nothing runs at all.

Expect the first Windows run to be RED and to stay red for a while. That is information, not failure: the point is to make OS divergence visible in CI instead of discovering it from user reports. Budget for triage, and prefer quarantining known-red cases with explicit tracking over deleting or skipping them.
