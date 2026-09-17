---
id: "be4d8de4-31a8-4caa-bd27-f28902b93d32"
level: "task"
title: "Implement scoped dead-code and duplication analyzer for production files"
status: "completed"
priority: "medium"
tags:
  - "self-heal"
  - "cleanup"
  - "dead-code"
  - "sourcevision"
source: "smart-add"
startedAt: "2026-04-14T20:10:15.439Z"
completedAt: "2026-04-14T20:16:38.577Z"
acceptanceCriteria:
  - "Identifies dead exports not referenced anywhere in the import graph, excluding test consumers"
  - "Identifies unused imports (imported symbol never referenced in file body)"
  - "Identifies near-duplicate utility functions across files using structural or textual similarity"
  - "Excludes all files matching *.test.ts, *.spec.ts, tests/**, and __fixtures__/**"
  - "Produces a ranked cleanup candidate list sorted by confidence and estimated blast radius"
  - "Integrates with sourcevision MCP or public API rather than re-implementing graph traversal"
  - "Does not modify any files — analysis only"
description: "Build a static analysis step that uses sourcevision's existing dead-export detection and import graph, augmented with a structural similarity pass for near-duplicate utility functions across non-test source files. Produces a prioritized list of cleanup candidates with file paths, confidence scores, and suggested actions. This step is analysis-only — no files are modified."
---
