---
id: "c94d8eed-5685-48c6-8263-d796974538ed"
level: "feature"
title: "Rename .rex/tree to .rex/prd_tree as Canonical PRD Storage Location"
status: "pending"
source: "smart-add"
acceptanceCriteria: []
description: "Rename the canonical PRD folder-tree storage directory from .rex/tree to .rex/prd_tree across all read/write call sites, configuration, documentation, and tests. The new name communicates more clearly that this directory holds the authoritative PRD task hierarchy and avoids the generic 'tree' name."
---

# Rename .rex/tree to .rex/prd_tree as Canonical PRD Storage Location

 [pending]

## Summary

Rename the canonical PRD folder-tree storage directory from .rex/tree to .rex/prd_tree across all read/write call sites, configuration, documentation, and tests. The new name communicates more clearly that this directory holds the authoritative PRD task hierarchy and avoids the generic 'tree' name.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Rename .rex/tree path constants and update all serializer/parser/store call sites | task | pending | 1970-01-01 |
| Update CLAUDE.md, README, and folder-tree schema docs to reference .rex/prd_tree | task | pending | 1970-01-01 |

## Info

- **Status:** pending
- **Level:** feature
