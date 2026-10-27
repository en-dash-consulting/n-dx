---
id: "df292b37-e2f6-448f-ba8b-22f6f301a41e"
type: "change"
title: "Implement --show-individual flag for ndx status with per-PRD breakdown"
slug: "implement-show-individual-flag-for-ndx"
intent: "Extend ndx status (and rex status) with a --show-individual flag that, instead of showing the merged aggregate tree, prints status sections grouped by source PRD file. Each section should include the PRD file path, a header, and the same stats/tree the default status produces but scoped to items originating from that file. Honor existing flags (--format=json, filters) by emitting an array of per-PRD status objects in JSON mode."
acceptanceCriteria:
  - "ndx status --show-individual prints one labeled section per PRD file (canonical .rex/prd.md plus any branch-scoped .rex/prd_{branch}_{date}.md)"
  - "Each section shows the PRD file path and per-file completion stats (total/completed/pending counts)"
  - "Items are attributed to their source PRD file using existing branch/source-file metadata; no item appears in more than one section"
  - "--format=json with --show-individual emits an array where each element has prdPath, stats, and items fields"
  - "When only one PRD file exists, the flag still works and produces a single section without error"
  - "Help text for ndx status documents the new flag with a brief usage example"
  - "Integration test covers both single-PRD and multi-PRD scenarios in human and JSON output modes"
amends: [{"target":"73fc1ee2-42b8-4be6-b743-c269308f0868","delta":"modified","summary":"Implement --show-individual flag for ndx status with per-PRD breakdown","base":"21c1250c779670cae488ce49a47e4d4ddd8109eadc4d4ebbb20f401401c4bd70"}]
priority: "medium"
tags:
  - "rex"
  - "cli"
  - "status"
source: "smart-add"
---
