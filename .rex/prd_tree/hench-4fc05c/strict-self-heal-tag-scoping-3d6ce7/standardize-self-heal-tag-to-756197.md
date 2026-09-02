---
id: "75619751-480b-48cb-b543-7409f49387b0"
level: "task"
title: "Standardize self-heal tag to 'self-heal-items' across creation and selection paths"
status: "completed"
priority: "high"
tags:
  - "hench"
  - "self-heal"
  - "prd"
source: "smart-add"
startedAt: "2026-05-06T03:12:31.242Z"
completedAt: "2026-05-06T13:01:09.053Z"
endedAt: "2026-05-06T13:01:09.053Z"
resolutionType: "code-change"
resolutionDetail: "Standardized SELF_HEAL_TAG constant from 'self-heal' to 'self-heal-items' across all creation and selection paths. Auto-applied tag filter in self-heal mode. All acceptance criteria met: single constant exports tag value; PRD items created in self-heal runs carry the tag; hench selector enforces tag filter automatically; no legacy migration needed."
acceptanceCriteria:
  - "A single exported constant defines the self-heal tag value and is imported by both the creation paths and the selector"
  - "Every PRD item created during a self-heal run carries the 'self-heal-items' tag in its persisted frontmatter"
  - "Hench task selection in self-heal mode returns only items whose tags include 'self-heal-items'; untagged or differently-tagged items are skipped with a logged reason"
  - "If a legacy 'self-heal' tag still exists on past items, the selector treats it as equivalent OR a one-time migration retags them — the chosen approach is documented in the commit message"
description: "Audit every code path that creates PRD items during a self-heal run (recommend, analyze, smart-add, ad-hoc add) and ensure each one stamps the 'self-heal-items' tag onto new epics, features, and tasks. Audit the hench task selector's self-heal-mode filter to require this exact tag. Reconcile any references to a legacy 'self-heal' tag — either migrate them to 'self-heal-items' or define both as equivalent in a single canonical constant — so creation and selection use the same source of truth."
---
