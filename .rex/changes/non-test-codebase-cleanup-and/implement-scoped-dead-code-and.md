---
id: "be4d8de4-31a8-4caa-bd27-f28902b93d32"
type: "task"
title: "Implement scoped dead-code and duplication analyzer for production files"
slug: "implement-scoped-dead-code-and"
description: "Build a static analysis step that uses sourcevision's existing dead-export detection and import graph, augmented with a structural similarity pass for near-duplicate utility functions across non-test source files. Produces a prioritized list of cleanup candidates with file paths, confidence scores, and suggested actions. This step is analysis-only — no files are modified."
acceptanceCriteria:
  - "Identifies dead exports not referenced anywhere in the import graph, excluding test consumers"
  - "Identifies unused imports (imported symbol never referenced in file body)"
  - "Identifies near-duplicate utility functions across files using structural or textual similarity"
  - "Excludes all files matching *.test.ts, *.spec.ts, tests/**, and __fixtures__/**"
  - "Produces a ranked cleanup candidate list sorted by confidence and estimated blast radius"
  - "Integrates with sourcevision MCP or public API rather than re-implementing graph traversal"
  - "Does not modify any files — analysis only"
priority: "medium"
tags:
  - "self-heal"
  - "cleanup"
  - "dead-code"
  - "sourcevision"
source: "smart-add"
---
