---
id: "55365572-23e3-497d-a072-7aee77c8bf4f"
level: "task"
title: "Add architecture-policy test enforcing prd.md is not read or written outside migration helper"
status: "pending"
priority: "medium"
tags:
  - "rex"
  - "prd"
  - "testing"
  - "architecture"
source: "smart-add"
acceptanceCriteria:
  - "New e2e architecture-policy test scans all packages for '.rex/prd.md' string and path references"
  - "Test passes when references are confined to the migration helper and its tests"
  - "Test fails with a clear message naming the offending file when a new prd.md reference is introduced"
  - "Test runs as part of pnpm test and the existing CI pipeline"
description: "Add an architecture-policy test (similar to existing domain-isolation/architecture-policy suites) that statically scans the codebase for references to '.rex/prd.md' and fails the build if any reference appears outside the legacy migration helper module. This locks the folder-tree-only invariant against future regressions."
---

# Add architecture-policy test enforcing prd.md is not read or written outside migration helper

🟡 [pending]

## Summary

Add an architecture-policy test (similar to existing domain-isolation/architecture-policy suites) that statically scans the codebase for references to '.rex/prd.md' and fails the build if any reference appears outside the legacy migration helper module. This locks the folder-tree-only invariant against future regressions.

## Info

- **Status:** pending
- **Priority:** medium
- **Tags:** rex, prd, testing, architecture
- **Level:** task
