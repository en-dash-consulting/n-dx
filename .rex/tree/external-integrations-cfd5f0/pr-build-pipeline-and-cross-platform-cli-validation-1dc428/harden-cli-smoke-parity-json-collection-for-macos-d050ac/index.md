---
id: "d050ace2-ba93-4528-8370-98be3ac9348f"
level: "task"
title: "Harden CLI smoke parity JSON collection for macOS and Windows runners"
status: "completed"
priority: "critical"
tags:
  - "ci"
  - "cli"
  - "cross-platform"
  - "windows"
  - "macos"
source: "smart-add"
startedAt: "2026-04-07T19:50:31.008Z"
completedAt: "2026-04-07T19:53:21.439Z"
acceptanceCriteria:
  - "Running `node scripts/cli-smoke-parity.mjs collect --cli-command ndx --output <file>` on both macOS and Windows produces a valid JSON artifact with no parse failure"
  - "The collector ignores or safely isolates non-JSON warnings and stderr output so deprecation warnings do not corrupt the JSON payload"
  - "If the CLI output is incomplete or malformed, the script exits with a classified error message that identifies the failing stage instead of throwing a raw JSON parse exception"
  - "Regression coverage exists for warning-prefixed or mixed-stream output representative of the failing CI scenario"
description: "Fix the `scripts/cli-smoke-parity.mjs collect` flow so CI can reliably capture and parse `ndx` output even when Node emits deprecation warnings or platform-specific noise, preventing `Unexpected end of JSON input` failures in the macOS and Windows jobs."
---

# Harden CLI smoke parity JSON collection for macOS and Windows runners

🔴 [completed]

## Summary

Fix the `scripts/cli-smoke-parity.mjs collect` flow so CI can reliably capture and parse `ndx` output even when Node emits deprecation warnings or platform-specific noise, preventing `Unexpected end of JSON input` failures in the macOS and Windows jobs.

## Info

- **Status:** completed
- **Priority:** critical
- **Tags:** ci, cli, cross-platform, windows, macos
- **Level:** task
- **Started:** 2026-04-07T19:50:31.008Z
- **Completed:** 2026-04-07T19:53:21.439Z
- **Duration:** 2m
