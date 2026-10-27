---
id: "83cafd67-4b87-4a64-a16f-936f0b78b775"
type: "change"
title: "Add integration tests validating TTY-aware color emission and NO_COLOR suppression across all CLI tools"
slug: "add-integration-tests-validating-tty"
intent: "Without automated checks, color regressions (raw ANSI codes polluting piped JSON output, NO_COLOR being silently ignored, or colors absent in real TTY sessions) are invisible in CI. This task adds a test harness that spawns each CLI tool and asserts color code presence or absence based on the execution context."
acceptanceCriteria:
  - "Tests spawn rex, sourcevision, hench, and ndx and assert ANSI escape codes are present when stdout is a TTY (or simulated TTY)"
  - "Tests assert ANSI codes are stripped when stdout is piped or when NO_COLOR=1 is set in the environment"
  - "Coverage includes at least one representative output per tool: rex status, sourcevision analyze summary, hench run summary, and ndx orchestrator log line"
  - "All tests pass in CI and are wired into the standard test suite via pnpm test"
amends: [{"target":"c513f257-7f0b-4bce-9bf5-82f5cc909ef0","delta":"modified","summary":"Add integration tests validating TTY-aware color emission and NO_COLOR suppression across all CLI tools","base":"1e28002259109e9a8bd47aef3d5202b22ee4f6097b040bf1928b74254b12765e"}]
priority: "medium"
tags:
  - "cli"
  - "testing"
  - "color"
source: "smart-add"
---
