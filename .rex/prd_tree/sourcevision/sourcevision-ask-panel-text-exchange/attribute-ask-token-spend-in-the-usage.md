---
id: "8b9c7d5a-e5fa-409c-a557-1f2d14230766"
level: "task"
title: "Attribute Ask token spend in the usage rollup"
status: "pending"
priority: "medium"
tags:
  - "web"
  - "tokens"
  - "rex"
  - "observability"
blockedBy:
  - "74c3fee8-3281-4b30-8157-8794ea68aea5"
source: "ndx-capture"
acceptanceCriteria:
  - "Every ask records vendor, model, input tokens, output tokens, and cache tokens"
  - "Recorded ask spend appears in the token-usage view, distinguishable from hench run spend"
  - "Cache tokens are reported rather than hidden, consistent with the existing hench/rex cache-token reporting"
  - "A failed or timed-out ask records whatever tokens were actually consumed rather than silently dropping them"
  - "A unit test asserts an ask's usage reaches the rollup with the correct vendor/model attribution"
description: "Each ask spends real tokens from an interactive surface that currently has no accounting path -- unlike hench runs, which are recorded under .hench/runs/ and rolled up per PRD item by rex's aggregateItemTokenUsage (exported via rex-gateway.ts:77). Without this task the dashboard's own LLM spend is invisible in the very view that reports token usage.\n\nRecord vendor, model, input/output tokens, and cache tokens per ask, and surface the total in the token-usage view. Follow the cache-token reporting decision already made for hench and rex (report cache tokens rather than hiding them). Whether asks are attributed to a PRD item or reported as a separate dashboard-spend bucket is an open call -- asks are not task-scoped, so a separate bucket is the likely answer."
lastModified: "2026-09-01T14:05:36.888Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
