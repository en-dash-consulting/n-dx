---
id: "2fc45532-6443-43ad-ba55-c0668a2fcd33"
level: "task"
title: "Add regression tests that verify hint surfacing and follow-through correctness"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "testing"
  - "hints"
source: "smart-add"
startedAt: "2026-04-13T16:18:43.018Z"
completedAt: "2026-04-13T16:34:36.589Z"
acceptanceCriteria:
  - "At least one test per package (ndx/rex/hench/sourcevision) invokes a mistyped or unknown command and asserts that a hint is emitted referencing a valid command"
  - "Each hint test follows the hinted command and asserts it exits 0 (or the expected code)"
  - "Test descriptions reference hint validation explicitly (e.g., 'hint text matches valid command')"
  - "Tests run as part of the existing integration test suite without additional setup"
  - "No existing test suite regressions introduced"
description: "Implement tests that invoke CLI commands under error or ambiguity conditions, capture the hint/suggestion output, assert the hint text is present and well-formed, and then execute the suggested follow-up command to confirm it succeeds. Tests should cover: typo-correction suggestions, related-command hints after unknown-command errors, flag-validation hints, and next-step suggestions after successful operations. Tests must reference that they are validating hint output explicitly."
---
