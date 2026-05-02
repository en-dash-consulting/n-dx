---
id: "3b442642-e7e9-49a4-96fc-debd8da30fc1"
level: "task"
title: "Write end-to-end and concurrency tests for markdown-primary PRD storage"
status: "completed"
priority: "high"
tags:
  - "rex"
  - "testing"
  - "storage"
source: "smart-add"
startedAt: "2026-04-24T16:08:51.271Z"
completedAt: "2026-04-24T16:20:10.138Z"
acceptanceCriteria:
  - "Integration test covers: init → add → edit → update_status → move using prd.md as primary, verifying prd.json stays in sync after each step"
  - "Fallback path test: PRDStore.load() with only prd.json present triggers migration and subsequent reads come from prd.md"
  - "Concurrent write test: two rapid mutations do not corrupt prd.md or produce a prd.json that diverges from it"
  - "Existing PRD storage tests in tests/integration/ updated to validate both prd.md and prd.json after mutations"
  - "Test suite passes on both macOS and Linux CI environments"
description: "Add integration and e2e tests that exercise the full lifecycle of prd.md as primary storage: initialization, mutation via CLI and MCP tools, dual-write consistency, fallback path, and concurrent write safety. Ensure the existing domain-isolation and PRD storage tests are updated to cover the markdown layer."
---

# Write end-to-end and concurrency tests for markdown-primary PRD storage

🟠 [completed]

## Summary

Add integration and e2e tests that exercise the full lifecycle of prd.md as primary storage: initialization, mutation via CLI and MCP tools, dual-write consistency, fallback path, and concurrent write safety. Ensure the existing domain-isolation and PRD storage tests are updated to cover the markdown layer.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** rex, testing, storage
- **Level:** task
- **Started:** 2026-04-24T16:08:51.271Z
- **Completed:** 2026-04-24T16:20:10.138Z
- **Duration:** 11m
