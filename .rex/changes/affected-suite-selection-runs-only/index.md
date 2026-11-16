---
id: "73ecf9cc-8ee3-4269-a433-c6e60ef41690"
type: "change"
title: "Affected-suite selection runs only root when shared vitest tooling under tests/ changes"
slug: "affected-suite-selection-runs-only"
summary: "Changing a shared test helper that every package's test setup loads only re-runs the root tests locally, so a break in a package's test setup slips past the local gate and is caught only in CI."
intent: "Scenario: edit only tests/test-max-workers.mjs or tests/vitest-isolation.mjs (or tests/hidden-child-process-alias.mjs, tests/setup-*.js), all imported by every packages/*/vitest.config.ts. `node scripts/run-all-tests.mjs affected main --list` selects only `root` (scripts/lib/select-suites.mjs:317 ROOT_PREFIXES maps tests/ to root; only the root vitest.config.js is in RUN_EVERYTHING_FILES at :293). A helper change that breaks a package config (throws, wrong export) passes hench's affected gate and fails only in CI.\n\nReachable: hench test gate (`hench.testGate.command`) on any task that edits shared vitest tooling. Pre-existing (vitest-isolation.mjs and the setup files have the same gap); surfaced by the review of d34d2902, which added tests/test-max-workers.mjs. Verdict out-of-scope, severity low.\n\nOptions: (A, recommended) treat tests/ files imported by package vitest configs as run-everything — derive the list by scanning packages/*/vitest.config.ts for `../../tests/` imports and setupFiles, so it cannot go stale; cost small, risk: such edits run all suites (~9 min). (B) hand-maintained list in RUN_EVERYTHING_FILES; cheaper, goes stale."
acceptanceCriteria:
  - "`run-all-tests.mjs affected <base> --list` selects every package suite whose vitest config imports a changed tests/ module (e.g. tests/test-max-workers.mjs, tests/vitest-isolation.mjs)"
  - "A unit test in tests/unit/select-suites.test.js fails if a tests/ file referenced by a package vitest config selects only root"
touches:
  - "dde6d1c4-a1bd-4dfe-9af8-0ec057addf16"
priority: "low"
discoveredFrom: {"item":"d34d2902-408a-4b05-9de9-7b2932aae778","run":"045c75df-4f5b-4e71-acb7-a634cae6934c"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "testing"
source: "ndx-adversarial-review"
---
