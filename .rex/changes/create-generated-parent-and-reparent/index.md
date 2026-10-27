---
id: "aa3c7e0f-a6fc-45d5-b2f4-56c67f07ccbf"
type: "change"
title: "Create generated parent and reparent hash-suffixed children during reshape"
slug: "create-generated-parent-and-reparent"
intent: "For each ConsolidationGroup produced by the detector, materialize a new parent PRD item at the same level under the original common parent, using the shared base title (suffix-stripped) as the parent title. Move all member items to be children of this new parent, preserving their IDs, status, tags, LoE, timestamps, and any existing child subtrees. The operation must use the folder-tree write path (no JSON dual-write), respect the single-child compaction rule (do not generate a parent when only one child would result), and record a reshape audit-trail entry mirroring the existing same-parent duplicate merge pattern (pre-reshape commit hash, reasoning, original parent path, new parent path, moved item IDs)."
acceptanceCriteria:
  - "New parent is written to .rex/prd_tree/ as a folder with index.md at the correct level"
  - "All group members are reparented and their original folders/files removed from the prior location"
  - "Item IDs, status, tags, LoE fields, and child subtrees are preserved verbatim through the move"
  - "Audit-trail entry is appended to .rex/archive.json with pre-reshape commit, reasoning, and ID list"
  - "No JSON files are produced by the operation; only folder-tree writes occur"
  - "Integration test confirms a fixture PRD with three hash-suffixed siblings ends up with one new parent and three reparented children after reshape"
touches:
  - "d08290fd-0664-4fb9-8881-0974b2879c50"
priority: "high"
tags:
  - "rex"
  - "reshape"
  - "folder-tree"
source: "smart-add"
---
