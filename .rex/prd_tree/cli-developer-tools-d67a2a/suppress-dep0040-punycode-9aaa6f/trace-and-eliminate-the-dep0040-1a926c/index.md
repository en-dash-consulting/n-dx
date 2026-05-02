---
id: "1a926c58-e25d-417b-96ef-0694ac9153e8"
level: "task"
title: "Trace and eliminate the DEP0040 punycode deprecation source"
status: "completed"
priority: "medium"
tags:
  - "cli"
  - "dx"
  - "node"
source: "smart-add"
startedAt: "2026-04-08T14:48:24.897Z"
completedAt: "2026-04-08T14:55:50.193Z"
acceptanceCriteria:
  - "Running any ndx/rex/hench/sv command produces no DEP0040 punycode deprecation line in stdout or stderr"
  - "The root dependency introducing punycode is identified and documented in the commit or PR description"
  - "If a dependency upgrade is made, the full test suite passes without regressions"
  - "No use of process.noDeprecation or --no-deprecation flags as the sole fix (root cause must be addressed)"
description: "Identify which direct or transitive dependency triggers the 'The punycode module is deprecated' warning (DEP0040) at runtime. Use `node --trace-deprecation` or audit `node_modules` to pinpoint the culprit package, then either upgrade it to a version that uses the `punycode` userland package, replace it with an equivalent dependency, or patch the import path to the userland alternative. Confirm the warning is eliminated across all CLI entry points (ndx, rex, hench, sv)."
---

# Trace and eliminate the DEP0040 punycode deprecation source

🟡 [completed]

## Summary

Identify which direct or transitive dependency triggers the 'The punycode module is deprecated' warning (DEP0040) at runtime. Use `node --trace-deprecation` or audit `node_modules` to pinpoint the culprit package, then either upgrade it to a version that uses the `punycode` userland package, replace it with an equivalent dependency, or patch the import path to the userland alternative. Confirm the warning is eliminated across all CLI entry points (ndx, rex, hench, sv).

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** cli, dx, node
- **Level:** task
- **Started:** 2026-04-08T14:48:24.897Z
- **Completed:** 2026-04-08T14:55:50.193Z
- **Duration:** 7m
