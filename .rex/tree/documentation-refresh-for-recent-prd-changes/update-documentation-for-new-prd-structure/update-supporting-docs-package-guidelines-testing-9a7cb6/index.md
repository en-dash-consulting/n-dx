---
id: "9a7cb6af-cd94-4904-9e5a-1274e996fc09"
level: "task"
title: "Update supporting docs (PACKAGE_GUIDELINES, TESTING, workflow docs) for recent merges"
status: "completed"
priority: "medium"
tags:
  - "documentation"
  - "testing"
  - "architecture"
source: "smart-add"
startedAt: "2026-04-23T03:10:48.937Z"
completedAt: "2026-04-23T03:15:07.826Z"
resolutionType: "code-change"
resolutionDetail: "Updated TESTING.md Required Coverage table + scenario-to-file pointer table for legacy multi-file PRD migration, cross-vendor authoring regression, self-heal test gate, Codex-batch fallback, and pair-programming cross-vendor review. Added single-file PRD invariant paragraph to PACKAGE_GUIDELINES.md §.rex/ Write-Access Protocol. Verified no workflow guide docs reference branch-scoped or multi-file layouts (grep-clean across docs/guide/*). Cross-checked with docs/doc-delta-audit.md §3.4/§3.5/§6. Docs-only — no code or link breakage."
acceptanceCriteria:
  - "PACKAGE_GUIDELINES.md references to PRD layout or rex add pipelines are current"
  - "TESTING.md reflects any new or updated required tests from recent merges (e.g. multi-file validation)"
  - "Any workflow documentation describing the add/recommend pipeline matches current branch-scoped targeting behavior"
  - "All updated docs are cross-checked against the audit delta report — no listed change is missing a corresponding doc update"
  - "Running a spell/link check or equivalent confirms no broken internal links introduced by edits"
description: "Update PACKAGE_GUIDELINES.md, TESTING.md, and any workflow or architecture documents that reference PRD file layout, add/recommend pipelines, or duplicate detection behavior. Ensure test documentation reflects any new required tests or validation from the multi-file backend validation merge, and that architectural guidance mentions the new file-targeting behavior where relevant."
---

# Update supporting docs (PACKAGE_GUIDELINES, TESTING, workflow docs) for recent merges

🟡 [completed]

## Summary

Update PACKAGE_GUIDELINES.md, TESTING.md, and any workflow or architecture documents that reference PRD file layout, add/recommend pipelines, or duplicate detection behavior. Ensure test documentation reflects any new required tests or validation from the multi-file backend validation merge, and that architectural guidance mentions the new file-targeting behavior where relevant.

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** documentation, testing, architecture
- **Level:** task
- **Started:** 2026-04-23T03:10:48.937Z
- **Completed:** 2026-04-23T03:15:07.826Z
- **Duration:** 4m
