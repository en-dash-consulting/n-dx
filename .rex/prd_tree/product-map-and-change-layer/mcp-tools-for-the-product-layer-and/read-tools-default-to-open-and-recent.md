---
id: "915602c4-7bf0-4495-bba6-260c8e71d297"
level: "task"
title: "Read tools default to open and recent changes, with paging"
status: "pending"
priority: "high"
tags:
  - "pr-17"
  - "lane-rex-surface"
  - "rex"
  - "token-budget"
source: "roadmap"
acceptanceCriteria:
  - "On a fixture with hundreds of applied changes, the default response of each listing read tool stays within a fixed size (test)"
  - "Callers can page through all history with the cursor parameter (test)"
  - "Aggregate counts in get_prd_status still cover all changes"
run: {"contextNotes":"Rebuild before finishing: after your last edit under packages/<pkg>/src, run `pnpm --filter @n-dx/<pkg> build`, and run it again if the adversarial review repairs any file under packages/<pkg>/src. Hench runs its affected test gate right after the review without rebuilding, and the gate refuses a stale dist/ (runs d3e891fe and 699cd138 failed this way; tracked as a hench bug under d0c26ff0)."}
description: "History grows without limit (all applied changes are kept), but nothing an agent calls should grow with it. Any rex MCP read tool that can list changes or tasks (get_prd_status, get_product, and any change-listing tool added in this PR) returns open changes plus applied changes from a recent window by default, with explicit optional parameters for more: a status filter, a since/release filter and a cursor-based page. Counts and stats may still cover everything. Settle this before 1.0.0: MCP response shapes and defaults freeze then (decision N3)."
lastModified: "2026-10-08T21:43:54.883Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
