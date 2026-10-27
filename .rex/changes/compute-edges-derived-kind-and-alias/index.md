---
id: "97adaba2-0872-4fc1-bb68-d4d45842f91e"
type: "change"
title: "Compute edges, derived kind and alias resolution"
slug: "compute-edges-derived-kind-and-alias"
intent: "changed by and bound by (inverses), realized by (files and zones from commits of changes that amended the capability), co-changes, and the derived kind (feature, enhancement, retirement, fix, refactor, policy change, spike). Cache under .ndx/rex/.cache (gitignored). Lookups resolve aliases of folded ids. Commits come from the trailer lookup (computed), not from stored state."
acceptanceCriteria:
  - "Derived kind matches the design table (tests)"
  - "Cache files are gitignored and rebuilt when missing"
  - "get by an aliased id returns the node it was folded into"
touches:
  - "4cd7c27a-13d3-4fd3-85b4-9f309a4237fd"
priority: "medium"
tags:
  - "pr-11"
  - "lane-rex-domain"
  - "rex"
source: "roadmap"
blockedBy:
  - "e50d9c97-8cf6-409b-b9bb-c6d00f832599"
---
