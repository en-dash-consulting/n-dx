---
id: "03832394-1df4-4f12-82c5-b55a9d76914a"
level: "task"
title: "Fix observation in global: Bidirectional coupling: \"web-server\" ↔ \"web-viewer\" (31+72 crossings) — consider"
status: "completed"
priority: "critical"
tags:
  - "self-heal"
  - "codex"
  - "hench"
source: "smart-add"
startedAt: "2026-04-14T20:56:54.685Z"
completedAt: "2026-04-14T21:05:55.177Z"
acceptanceCriteria:
  - "A written finding lists every code path in the self-heal batch loop that branches or fails on Codex input/output"
  - "The root-cause failure mode is reproducible in a unit or integration test against a Codex fixture"
  - "Each incompatibility is tagged with the file and line number where the Claude-specific assumption lives"
description: "Trace the full self-heal batch execution path — from batch construction through LLM invocation to result parsing — and document every assumption that holds only for Claude (API response shape, tool-use availability, streaming format, token field names). Reproduce the Codex failure mode with a minimal fixture and attach the error context to inform the fix."
__parentAcceptanceCriteria: []
__parentCompletedAt: "2026-04-16T17:33:49.851Z"
__parentDescription: "- Bidirectional coupling: \"web-server\" ↔ \"web-viewer\" (31+72 crossings) — consider extracting shared interface"
__parentId: "1e94a947-26f6-4e13-b517-06005ed53afb"
__parentLevel: "feature"
__parentPriority: "high"
__parentSource: "sourcevision"
__parentStartedAt: "2026-04-16T17:33:49.851Z"
__parentStatus: "completed"
__parentTitle: "Fix observation in global (1 finding)"
---
