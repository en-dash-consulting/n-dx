---
id: "ba3c3b84-a084-4188-9292-a2e8e5ac650f"
type: "change"
title: "Fall back to a full import analysis on a malformed imports.json by default"
slug: "fall-back-to-a-full-import-analysis-on"
intent: "From the 2026-11-12 feature-flag audit. analyzeImports (packages/sourcevision/src/analyzers/imports.ts) takes the incremental path when a previous imports.json exists. A legacy or partial imports.json whose edges or external are not arrays makes buildIncrementalState throw \"prev.external is not iterable\". The guard that falls back to a full re-analysis instead has been opt-in behind NDX_SV_SAFE_INCREMENTAL=1 since 2026-07-01 (b9570fd2d) and is undocumented. A crash fix should not need opting into: make the guard unconditional and stop reading the variable."
acceptanceCriteria:
  - "Analyzing with a previous imports.json whose edges or external are not arrays runs a full import analysis and does not throw"
  - "A well-formed previous imports.json still takes the incremental path, with output unchanged"
  - "NDX_SV_SAFE_INCREMENTAL is no longer read anywhere"
  - "A regression test covers the legacy-shaped imports.json"
  - "A patch changeset for @n-dx/sourcevision"
touches:
  - "aac0a41c-0157-4cca-a75d-efd7655ba909"
priority: "medium"
tags:
  - "feature-flags"
  - "sourcevision"
source: "ndx-capture"
---
