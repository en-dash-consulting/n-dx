---
id: "d01f7636-0eff-4d7c-b827-736bd7e1039d"
type: "change"
title: "Stabilize repeatable parity verification across original macOS and Windows CI steps"
slug: "stabilize-repeatable-parity"
intent: "Make the two OS smoke-check heads deterministic and repeatable by ensuring they execute the same canonical `ndx` validation steps, compare against the expected baseline behavior, and fail only on real parity regressions rather than runner-specific instability."
acceptanceCriteria:
  - "The macOS and Windows CI jobs execute the same documented CLI smoke parity sequence and produce comparable output artifacts"
  - "Parity validation checks that the current responses match the established baseline/original expected steps for both OS jobs"
  - "At least one automated test or fixture-based validation covers repeat runs of the parity workflow and confirms stable output shape across executions"
  - "The CI pipeline completes successfully when outputs are equivalent and surfaces a clear diff when platform responses diverge"
touches:
  - "08464700-9955-4338-87b6-afea0646a6f8"
priority: "critical"
tags:
  - "ci"
  - "pipeline"
  - "parity"
  - "stability"
  - "cross-platform"
source: "smart-add"
---
