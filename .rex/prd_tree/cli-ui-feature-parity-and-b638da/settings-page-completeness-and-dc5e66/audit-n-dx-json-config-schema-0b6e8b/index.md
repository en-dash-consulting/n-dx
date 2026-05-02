---
id: "0b6e8b1d-bf43-42b3-91df-74ed3f234c66"
level: "task"
title: "Audit .n-dx.json config schema fields against settings page UI controls and document gaps"
status: "completed"
priority: "medium"
tags:
  - "settings"
  - "config"
  - "audit"
source: "smart-add"
startedAt: "2026-04-19T03:56:20.830Z"
completedAt: "2026-04-19T03:59:49.910Z"
resolutionType: "code-change"
resolutionDetail: "Produced docs/config-schema-ui-gap.md: 63 user-editable fields enumerated across all three config files; 19 present, 1 partial, 43 missing. P1–P6 priority gap list with control types and CLI commands. View placement recommendations for sibling implementation task."
acceptanceCriteria:
  - "All fields from .n-dx.json, .rex/config.json, and .hench/config.json schemas are enumerated"
  - "Each field is mapped to an existing settings control or flagged as missing"
  - "Recently added fields (cli.timeoutMs, cli.timeouts.*, llm.claude.lightModel, llm.codex.lightModel, per-tier model overrides) are explicitly included"
  - "Missing fields are annotated with the CLI command(s) they affect and a recommended control type"
  - "Fields already covered by hench-config.ts are marked as present and excluded from the gap list"
description: "Enumerate every field in the .n-dx.json and per-package config schemas (rex config, hench config, sourcevision config) and cross-reference against controls currently rendered in the settings page views (hench-config.ts, integration-config.ts, notion-config.ts). Produce a missing-field list annotated with the CLI command(s) each field affects and a suggested UI control type (text, number, select, toggle, list)."
---

# Audit .n-dx.json config schema fields against settings page UI controls and document gaps

🟡 [completed]

## Summary

Enumerate every field in the .n-dx.json and per-package config schemas (rex config, hench config, sourcevision config) and cross-reference against controls currently rendered in the settings page views (hench-config.ts, integration-config.ts, notion-config.ts). Produce a missing-field list annotated with the CLI command(s) each field affects and a suggested UI control type (text, number, select, toggle, list).

## Info

- **Status:** completed
- **Priority:** medium
- **Tags:** settings, config, audit
- **Level:** task
- **Started:** 2026-04-19T03:56:20.830Z
- **Completed:** 2026-04-19T03:59:49.910Z
- **Duration:** 3m
