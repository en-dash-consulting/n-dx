---
id: "03ef01ab-cea6-48f9-934b-c06c6fbf5673"
type: "task"
title: "Extension manifest schema and validator"
slug: "extension-manifest-schema-and-validator"
acceptanceCriteria:
  - "JSON Schema for `ndx.extension` v1 (all fields in the manifest table) in `packages/core`, with types"
  - "Validation reports every problem as one line: package, JSON path, rule, fix"
  - "Reserved names (built-in commands, bin aliases, `ext`, `x`, `hub`, `extensions`) are rejected"
  - "Unknown `apiVersion` is reported as incompatible, not as invalid"
  - "A failing and a passing fixture per rule"
priority: "critical"
tags:
  - "extensions"
source: "ndx-capture"
---
