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
description: "History grows without limit (all applied changes are kept), but nothing an agent calls should grow with it. Any rex MCP read tool that can list changes or tasks (get_prd_status, get_product, and any change-listing tool added in this PR) returns open changes plus applied changes from a recent window by default, with explicit optional parameters for more: a status filter, a since/release filter and a cursor-based page. Counts and stats may still cover everything. Settle this before 1.0.0: MCP response shapes and defaults freeze then (decision N3)."
lastModified: "2026-10-06T23:22:38.316Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
