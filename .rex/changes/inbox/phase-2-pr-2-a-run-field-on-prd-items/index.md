---
id: "2d886812-6912-4ac7-a781-e64aeddb6f7d"
type: "change"
title: "Phase 2 PR 2: a run field on PRD items, writable through MCP and rex update, with PATCH locked to an allow-list"
slug: "phase-2-pr-2-a-run-field-on-prd-items"
intent: "Prepare task phase 2, PR 2 of 4 (design §6, TP5, TP9). Declares a strict `run` field (saved per-task run settings: model, provider, permissionMode, review, reviewModel, reviewOptional, skipTestGate, maxTurns, tokenBudget, contextNotes) on PRD items with one shared validator, makes it writable through MCP add_item/edit_item and `rex update --run`, and restricts `PATCH /api/rex/items/:id` to an allow-list inside store.withTransaction. Nothing reads `run` yet; PR 3 makes ndx work honour it before 0.9.0 ships."
plannedRelease: "0.9.0"
priority: "high"
tags:
  - "task-prep"
  - "0.9.0"
---
