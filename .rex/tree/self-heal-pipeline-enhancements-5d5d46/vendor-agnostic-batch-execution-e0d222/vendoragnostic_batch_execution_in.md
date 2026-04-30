---
id: "e0d22237-06af-4147-a3d7-c3a95c202d59"
level: "feature"
title: "Vendor-Agnostic Batch Execution in Self-Heal Loop"
status: "completed"
source: "smart-add"
startedAt: "2026-04-14T21:36:07.553Z"
completedAt: "2026-04-14T21:36:07.553Z"
acceptanceCriteria: []
description: "The self-heal loop batch processing fails when the active vendor is Codex. Batches must execute reliably regardless of whether Claude or Codex is configured, covering prompt format differences, response parsing, token budgeting, and error recovery paths."
---

## Children

| Title | Status |
|-------|--------|
| [Add regression tests for Codex batch execution in the self-heal pipeline](./add-regression-tests-for-codex-e72cad/index.md) | completed |
| [Add vendor-resilient error handling and retry logic for self-heal batch failures](./add-vendor-resilient-error-1074c4/index.md) | completed |
| [Audit self-heal batch pipeline for Codex incompatibilities](./audit-self-heal-batch-pipeline-1f2e14/index.md) | completed |
| [Implement vendor-aware batch construction and response handling in self-heal](./implement-vendor-aware-batch-97ec62/index.md) | completed |
