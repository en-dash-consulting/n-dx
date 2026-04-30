---
id: "95dde960-5ab0-4acd-b53e-7004ce3591d4"
level: "task"
title: "Add test coverage for Go zone edge resolution"
status: "completed"
priority: "high"
tags:
  - "sourcevision"
  - "go"
  - "tests"
source: "smart-add"
startedAt: "2026-03-26T20:09:20.039Z"
completedAt: "2026-04-13T18:35:49.604Z"
acceptanceCriteria:
  - "Unit test: directory-to-files resolver returns exact match for JS/TS-style file path input"
  - "Unit test: directory-to-files resolver returns all files under the prefix for Go-style directory path input"
  - "Unit test: `buildCrossings()` produces non-zero crossings when given Go-style directory edges"
  - "Integration test: full zone pipeline run against a Go fixture produces non-zero crossings and non-zero coupling scores"
  - "Regression test: JS/TS fixture zone crossings are identical before and after the resolver change"
description: "Validate the directory-to-files resolver and updated zone pipeline with unit and integration tests. Tests must cover the resolver in isolation, Go-specific crossing detection end-to-end, and a regression guard ensuring JS/TS zone behavior is unchanged."
---
