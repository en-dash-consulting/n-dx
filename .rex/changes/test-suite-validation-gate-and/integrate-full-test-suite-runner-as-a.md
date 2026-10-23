---
id: "c18166e3-f748-45f9-bda4-958d303783f6"
type: "task"
title: "Integrate full test suite runner as a mandatory self-heal gate step"
slug: "integrate-full-test-suite-runner-as-a"
description: "After dependency cleanup and codebase condensation phases, run pnpm test across all workspace packages. Capture per-package pass/fail status, failure counts, and raw error output. The gate result is stored in the run artifact under a 'testGate' key and drives the remediation sub-loop. If no files were modified in preceding phases, the gate step is skipped with a logged notice."
acceptanceCriteria:
  - "Runs pnpm test (full suite) after the cleanup and condensation phases complete"
  - "Captures per-package pass/fail, test count, failure count, and abbreviated failure output"
  - "Structured result is stored in the run artifact under a 'testGate' key"
  - "Gate step exits with a non-zero code on any package failure, triggering the remediation loop"
  - "Gate step is skipped with an explicit log notice when no source files were modified in prior phases"
  - "Total elapsed time per package is recorded for performance baseline tracking"
priority: "critical"
tags:
  - "self-heal"
  - "testing"
  - "gate"
  - "validation"
source: "smart-add"
---
