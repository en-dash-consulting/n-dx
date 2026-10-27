---
id: "0b6e8b1d-bf43-42b3-91df-74ed3f234c66"
type: "change"
title: "Audit .n-dx.json config schema fields against settings page UI controls and document gaps"
slug: "audit-n-dx-json-config-schema-fields"
intent: "Enumerate every field in the .n-dx.json and per-package config schemas (rex config, hench config, sourcevision config) and cross-reference against controls currently rendered in the settings page views (hench-config.ts, integration-config.ts, notion-config.ts). Produce a missing-field list annotated with the CLI command(s) each field affects and a suggested UI control type (text, number, select, toggle, list)."
acceptanceCriteria:
  - "All fields from .n-dx.json, .rex/config.json, and .hench/config.json schemas are enumerated"
  - "Each field is mapped to an existing settings control or flagged as missing"
  - "Recently added fields (cli.timeoutMs, cli.timeouts.*, llm.claude.lightModel, llm.codex.lightModel, per-tier model overrides) are explicitly included"
  - "Missing fields are annotated with the CLI command(s) they affect and a recommended control type"
  - "Fields already covered by hench-config.ts are marked as present and excluded from the gap list"
touches:
  - "dc5e6696-7575-4983-b8c5-a73711bc4d8f"
priority: "medium"
tags:
  - "settings"
  - "config"
  - "audit"
source: "smart-add"
---
