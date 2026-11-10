---
id: "5f3e5940-8d9d-46ba-b1b3-f88fc4bb26cd"
type: "task"
title: "No test catches analyze recording Jev availability without the run's helper result"
slug: "no-test-catches-analyze-recording-jev"
description: "Adversarial review of f5330af8 (should-fix, medium). packages/sourcevision/src/cli/commands/analyze.ts:350 sets run.jev = jevAvailability({ check: \"cached\" }). No sourcevision test covers that line: reverting it to jevAvailability() (helper reported unknown, never the run's real result) or to jevAvailability({ check: true }) (runs the helper at the end of every analysis, prompting a password manager during a fast run) passes every suite. The cached semantics are tested only in llm-client (tests/unit/typesafe-required.test.ts), so the acceptance criterion \"manifest.lastAnalysis.jev records available false when the helper failed during the analysis\" is verified by reading, not by a test. Reachable from every `ndx analyze` / `sv analyze` with a helper-backed TypeSafe key. Fix: a sourcevision test that stores a helper entry in a temp NDX_HOME (a node script that exits 1, writing a marker file), resolves the credential once as a Jev route would, runs finalizeTokenUsage (export it, or drive cmdAnalyze in fast mode), and asserts the manifest's lastAnalysis.jev; a second case with no Jev call asserts available: null and that the marker shows no run at finalize. Recommended: export finalizeTokenUsage for the test rather than a full analyze run (cheaper, deterministic)."
acceptanceCriteria:
  - "A sourcevision test fails when analyze.ts records jevAvailability() instead of the run's cached helper result: a helper that failed during the run must give lastAnalysis.jev { available: false, source: null }"
  - "The same test fails when analyze runs the helper itself: a run that never asked Jev records available: null and the helper's marker file shows no run at finalize"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "credential-store"
  - "sourcevision"
source: "ndx-adversarial-review"
---
