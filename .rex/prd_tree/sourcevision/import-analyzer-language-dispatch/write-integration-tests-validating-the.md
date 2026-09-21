---
id: "c42858ab-4a23-467f-b6e2-fccee6cb99f6"
level: "task"
title: "Write integration tests validating the Go import graph against the fixture project"
status: "completed"
priority: "critical"
tags:
  - "go"
  - "sourcevision"
  - "imports"
  - "integration-tests"
source: "smart-add"
startedAt: "2026-03-26T05:27:41.472Z"
completedAt: "2026-03-26T05:34:37.493Z"
acceptanceCriteria:
  - "Integration test runs analyzeImports end-to-end against the Go fixture directory"
  - "Internal edges main.go→internal/handler/, handler/→internal/service/, service/→internal/repository/ appear in the graph"
  - "Third-party packages (go-chi/chi, jmoiron/sqlx) appear as external entries in the graph"
  - "Stdlib packages (fmt, net/http, etc.) appear as external entries with stdlib: prefix"
  - "_test.go import handling is explicitly tested and the behavior (captured or excluded) is documented in the test"
  - "No edges from non-existent internal packages appear in the output"
  - "All integration tests pass with zero failures"
description: "Write integration tests that run the full import analyzer against the Go fixture at packages/sourcevision/tests/fixtures/go-project/ and assert on the produced import graph structure. Tests cover internal edges (main.go→handler/, handler/→service/, service/→repository/), third-party external packages (go-chi/chi, jmoiron/sqlx), stdlib entries, and the handling of _test.go imports."
---
