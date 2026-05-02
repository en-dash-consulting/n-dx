---
id: "e34e664a-b788-41e5-ad5d-95c94d9abd8a"
level: "feature"
title: "Centralized Model Resolution and Vendor Visibility Across All LLM Commands"
status: "completed"
source: "smart-add"
startedAt: "2026-04-21T17:23:33.802Z"
completedAt: "2026-04-21T17:23:33.802Z"
acceptanceCriteria: []
description: "Several rex commands that make LLM calls (reshape, reorganize, prune) pass the raw --model flag to downstream functions without explicitly calling resolveVendorModel or printing a vendor/model header. SourceVision analyze uses hardcoded DEFAULT_MODEL constants instead of the centralized resolver. This means config changes in .n-dx.json may not take effect uniformly, and users get no feedback about which model is being used."
---

# Centralized Model Resolution and Vendor Visibility Across All LLM Commands

 [completed]

## Summary

Several rex commands that make LLM calls (reshape, reorganize, prune) pass the raw --model flag to downstream functions without explicitly calling resolveVendorModel or printing a vendor/model header. SourceVision analyze uses hardcoded DEFAULT_MODEL constants instead of the centralized resolver. This means config changes in .n-dx.json may not take effect uniformly, and users get no feedback about which model is being used.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Add explicit resolveVendorModel and vendor/model header to reshape, reorganize, and prune commands | task | completed | 2026-04-21 |
| Replace hardcoded model defaults in sourcevision analyze with centralized resolveVendorModel | task | completed | 2026-04-21 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-21T17:23:33.802Z
- **Completed:** 2026-04-21T17:23:33.802Z
- **Duration:** < 1m
