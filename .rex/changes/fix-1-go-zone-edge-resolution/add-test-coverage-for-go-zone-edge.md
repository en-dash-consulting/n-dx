---
id: "95dde960-5ab0-4acd-b53e-7004ce3591d4"
type: "task"
title: "Add test coverage for Go zone edge resolution"
slug: "add-test-coverage-for-go-zone-edge"
description: "Validate the directory-to-files resolver and updated zone pipeline with unit and integration tests. Tests must cover the resolver in isolation, Go-specific crossing detection end-to-end, and a regression guard ensuring JS/TS zone behavior is unchanged."
acceptanceCriteria:
  - "Unit test: directory-to-files resolver returns exact match for JS/TS-style file path input"
  - "Unit test: directory-to-files resolver returns all files under the prefix for Go-style directory path input"
  - "Unit test: `buildCrossings()` produces non-zero crossings when given Go-style directory edges"
  - "Integration test: full zone pipeline run against a Go fixture produces non-zero crossings and non-zero coupling scores"
  - "Regression test: JS/TS fixture zone crossings are identical before and after the resolver change"
priority: "high"
tags:
  - "sourcevision"
  - "go"
  - "tests"
source: "smart-add"
---
