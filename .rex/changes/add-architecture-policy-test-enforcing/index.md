---
id: "55365572-23e3-497d-a072-7aee77c8bf4f"
type: "change"
title: "Add architecture-policy test enforcing prd.md is not read or written outside migration helper"
slug: "add-architecture-policy-test-enforcing"
intent: "Add an architecture-policy test (similar to existing domain-isolation/architecture-policy suites) that statically scans the codebase for references to '.rex/prd.md' and fails the build if any reference appears outside the legacy migration helper module. This locks the folder-tree-only invariant against future regressions."
acceptanceCriteria:
  - "New e2e architecture-policy test scans all packages for '.rex/prd.md' string and path references"
  - "Test passes when references are confined to the migration helper and its tests"
  - "Test fails with a clear message naming the offending file when a new prd.md reference is introduced"
  - "Test runs as part of pnpm test and the existing CI pipeline"
amends: [{"target":"5ec16345-5c46-4197-9fa3-bcb50d58ce19","delta":"modified","summary":"Add architecture-policy test enforcing prd.md is not read or written outside migration helper","base":"22432cae831a94c0049c42f06edaa5cf118c70b41de16ecbd1051c42e9b2157f"}]
priority: "medium"
tags:
  - "rex"
  - "prd"
  - "testing"
  - "architecture"
source: "smart-add"
---
