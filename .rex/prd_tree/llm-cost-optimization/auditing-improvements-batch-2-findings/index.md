---
id: "d770dfda-985a-431c-bec3-340c8e45cd18"
level: "feature"
title: "Auditing improvements batch 2 — findings from the prompt-caching runs"
status: "pending"
priority: "medium"
tags:
  - "llm"
  - "cost"
source: "triage items recorded during the PR #353 batch (merged as #390); index.md authored 2026-09-22 to repair the orphaned directory the #390 merge introduced"
acceptanceCriteria: []
description: "Container for the triage items recorded while building and auditing the prompt-caching batch (PR #353, merged to main as PR #390). The #390 merge brought these task files in without an index.md for their directory, which made them invisible to the rex store and unreferenced from the epic index; this index restores them to the tree. Two of the original five duplicated the WM2052/WM2051 tasks under 'Cost measurement lands' and were merged into those items."
lastModified: "2026-09-22T21:10:24.020Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [append_log is MCP-only — no CLI equivalent, so ndx work runs cannot write execution-log entries](./append-log-is-mcp-only-no-cli.md) | pending |
| [PACKAGE_GUIDELINES .rex/ write-access protocol documented a PRD layout that no longer exists](./package-guidelines-rex-write-access.md) | completed |
| [Run summary omits cache tokens, understating input ~65,000x](./run-summary-omits-cache-tokens.md) | completed |
