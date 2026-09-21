---
id: "5392be41-1f99-42d2-8f70-fe6185663517"
level: "task"
title: "Define OS-agnostic CLI error code taxonomy"
status: "completed"
priority: "critical"
tags:
  - "ci"
  - "cli"
  - "cross-platform"
  - "diagnostics"
source: "smart-add"
startedAt: "2026-04-07T22:37:10.572Z"
completedAt: "2026-04-07T22:47:20.604Z"
acceptanceCriteria:
  - "Each cross-platform-comparable CLI failure class has a unique, stable error code"
  - "The same logical failure produces the same error code on macOS and Windows"
  - "Human-readable error output includes the code alongside the existing diagnostic message"
  - "Unknown or uncategorized failures fall back to an explicit generic code path rather than omitting a code"
description: "Introduce a stable set of unique error codes for comparable failure classes so macOS and Windows smoke runs can be matched by semantics instead of platform-specific text output."
---
