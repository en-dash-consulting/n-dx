---
id: "32346cf4-1a0d-475f-8cca-41a6cee2ae9c"
type: "change"
title: "ndx sv analyze --fast and ndx plan --no-llm still run the npm registry update check"
slug: "ndx-sv-analyze-fast-and-ndx-plan-no"
summary: "A static-only scan started through another ndx command still contacts the npm registry once to check for a newer n-dx, so an offline batch scan is not fully network-free."
intent: "Verdict: should-fix (low). packages/core/cli.js main() skips startUpdateCheck only for `init --no-llm` and `analyze --fast` (staticRun, ~line 3891). `ndx sv analyze --fast .` / `ndx sourcevision analyze --fast .` (command `sv`/`sourcevision`, a builtin tool name, args after it) and `ndx plan --no-llm .` (which forwards --fast to sourcevision) still fetch https://registry.npmjs.org/@n-dx/core/latest when the 24h cache is cold, although sourcevision's help promises `--fast` makes no network call. Reachable from any scan wrapper that uses the delegation form. Pre-existing for those commands; this change fixed only `ndx analyze --fast`. Options: (a) recommended: extend staticRun to `sv`/`sourcevision` when rest[0] === \"analyze\" and rest includes --fast, and to `plan` with --no-llm; cost a few lines plus a fetch-recorder e2e per form (tests/fixtures/no-network/fetch-recorder.mjs). (b) an env opt-out (NDX_NO_UPDATE_CHECK=1) for batch wrappers; broader, but a new knob to document."
acceptanceCriteria:
  - "`ndx sv analyze --fast <dir>` with the fetch recorder loaded records no fetch"
  - "`ndx plan --no-llm <dir>` makes no update-check request"
  - "A test runs each form under the fetch recorder and fails if the registry is requested"
touches:
  - "dcf6018e-e658-4708-ae6e-1bd23431748f"
priority: "low"
discoveredFrom: {"item":"845a96b6-0a33-4fe6-96fb-03a9a6369299","run":"1e20da73-a3d7-4d9e-9b3d-6f12e7ed38ff"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "estate-readiness"
source: "ndx-adversarial-review"
---
