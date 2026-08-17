---
id: "3181cbc2-b8b7-45cf-98cc-abccadfe7352"
level: "feature"
title: "Execute the test suite on Windows and macOS in CI"
status: "pending"
priority: "high"
tags:
  - "cross-os"
  - "ci"
  - "testing"
  - "windows"
  - "macos"
source: "exploration-2026-08-17"
acceptanceCriteria:
  - "Unit, integration, and root e2e suites execute on windows-latest and macos-latest in CI"
  - "A Windows-only regression in a Windows code path fails CI rather than reaching users"
  - "Known-red cases are quarantined with explicit tracking, not silently skipped or deleted"
  - "CI wall-clock and cost impact are measured and stated — with the matrix scoped (e.g. OS-sensitive suites only) if the full suite proves impractical"
description: "The root enabler for every other parity item: no automated test executes on Windows or macOS today.\n\n.github/workflows/ci.yml as it stands:\n- `validate` (ubuntu-latest) — build, typecheck, docs, pr-check, `pnpm -r run test`, then `node scripts/run-vitest-bind-aware.mjs root` for the root e2e/integration suites, changeset checks\n- `smoke-macos` (macos-latest) — install, build, `scripts/cli-smoke-parity.mjs collect` ONLY\n- `smoke-windows` (windows-latest) — install, build, `scripts/cli-smoke-parity.mjs collect` ONLY\n- `smoke-parity` (ubuntu) — diffs the two collected artifacts\n\nThe smoke collector covers 8 read-only cases (version-text, version-json, unknown-command, typo-suggestion, help-rex, plan-help, status-missing-rex, status-json). It exercises no mutation, no spawn of a vendor CLI, no init, no MCP, no server. Consequence: win-spawn.js, the quoting twin, child-lifecycle's Windows branch, and every `isWin` conditional in the codebase ship having never been executed by a test on their target OS. It is also why 10 Windows-skipped test cases went unnoticed as a coverage gap — on ubuntu they simply run, and on Windows nothing runs at all.\n\nExpect the first Windows run to be RED and to stay red for a while. That is information, not failure: the point is to make OS divergence visible in CI instead of discovering it from user reports. Budget for triage, and prefer quarantining known-red cases with explicit tracking over deleting or skipping them."
---

## Children

| Title | Status |
|-------|--------|
| [Expand the CI matrix to run unit/integration/e2e suites on windows-latest and macos-latest](./expand-the-ci-matrix-to-run-da8af6.md) | pending |
