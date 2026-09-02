---
id: "4b559467-5391-4612-ab7d-27b71daac4dc"
level: "task"
title: "Expose timeout configuration in .n-dx.json schema and ndx config command"
status: "completed"
priority: "medium"
tags:
  - "cli"
  - "config"
  - "timeout"
source: "smart-add"
startedAt: "2026-04-03T19:06:47.150Z"
completedAt: "2026-04-17T04:37:07.922Z"
resolutionType: "code-change"
resolutionDetail: "Added validateTimeoutMs export, CLI_VALIDATORS wired via getValidator(), handleGet defaults for unset cli.timeoutMs, improved help text, and new unit tests."
acceptanceCriteria:
  - "`ndx config set cli.timeoutMs 3600000` persists the value to .n-dx.json and is read at next command invocation"
  - "`ndx config get cli.timeoutMs` prints the current value with its default noted if unset"
  - "The config schema validation rejects non-numeric or negative values with a descriptive error"
  - "`ndx config --help` lists all timeout-related keys with their defaults and descriptions"
  - "A unit test covers schema validation for valid, zero, and negative timeout values"
description: "Add `cli.timeoutMs` and `cli.timeouts.*` keys to the .n-dx.json config schema with documentation, validation, and support through `ndx config get/set`. Ensure `ndx config --help` describes the timeout keys and their defaults."
---
