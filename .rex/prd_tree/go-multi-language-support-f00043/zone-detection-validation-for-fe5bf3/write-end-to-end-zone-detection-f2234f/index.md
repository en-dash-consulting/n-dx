---
id: "f2234f89-f5b2-4bab-b901-30744cf878e0"
level: "task"
title: "Write end-to-end zone detection integration test for the Go fixture"
status: "completed"
priority: "high"
tags:
  - "go"
  - "sourcevision"
  - "zones"
  - "integration-tests"
source: "smart-add"
startedAt: "2026-03-26T05:46:36.251Z"
completedAt: "2026-03-26T05:52:26.151Z"
acceptanceCriteria:
  - "go-zones.test.ts runs the full SourceVision pipeline (inventory → imports → zones) against the Go fixture"
  - "Zone detection produces at least 2 distinct zones from the Go import graph"
  - "Each expected package boundary (cmd, handler, service, repository) is represented in at least one zone"
  - "Files from distinct packages are not co-located in the same zone unless the import graph warrants it"
  - "Test fails with a descriptive message if the import graph contains zero edges"
  - "All assertions pass with zero failures against the enhanced Go fixture"
description: "Write go-zones.test.ts that runs the full SourceVision pipeline (inventory → imports → zones) against packages/sourcevision/tests/fixtures/go-project/ and validates that Louvain community detection produces zones mapping to Go package boundaries. Expected zones correspond to cmd/, internal/handler/, internal/service/, and internal/repository/. The test must fail with a descriptive error if the import graph contains zero edges, guarding against silent parser failures upstream."
---

# Write end-to-end zone detection integration test for the Go fixture

🟠 [completed]

## Summary

Write go-zones.test.ts that runs the full SourceVision pipeline (inventory → imports → zones) against packages/sourcevision/tests/fixtures/go-project/ and validates that Louvain community detection produces zones mapping to Go package boundaries. Expected zones correspond to cmd/, internal/handler/, internal/service/, and internal/repository/. The test must fail with a descriptive error if the import graph contains zero edges, guarding against silent parser failures upstream.

## Info

- **Status:** completed
- **Priority:** high
- **Tags:** go, sourcevision, zones, integration-tests
- **Level:** task
- **Started:** 2026-03-26T05:46:36.251Z
- **Completed:** 2026-03-26T05:52:26.151Z
- **Duration:** 5m
