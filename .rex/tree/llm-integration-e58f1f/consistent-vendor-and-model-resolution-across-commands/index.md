---
id: "e4b6edfe-b8e0-4b6a-87d6-b0a79cca4eeb"
level: "feature"
title: "Consistent Vendor and Model Resolution Across Commands"
status: "completed"
source: "smart-add"
startedAt: "2026-04-08T14:47:55.036Z"
completedAt: "2026-04-08T14:47:55.036Z"
acceptanceCriteria: []
description: "Ensure a single, authoritative vendor/model resolution path is used across all ndx commands — including reasoning/thinking calls and standard API calls — so that no command silently diverges from the configured or defaulted model. Default resolution should produce the newest available model for the active vendor when no explicit model is configured."
---

# Consistent Vendor and Model Resolution Across Commands

 [completed]

## Summary

Ensure a single, authoritative vendor/model resolution path is used across all ndx commands — including reasoning/thinking calls and standard API calls — so that no command silently diverges from the configured or defaulted model. Default resolution should produce the newest available model for the active vendor when no explicit model is configured.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Implement centralized vendor/model resolver with newest-model default | task | completed | 2026-04-08 |
| Propagate resolved vendor/model uniformly to all LLM call sites | task | completed | 2026-04-08 |
| Surface active vendor and model in ndx console output | task | completed | 2026-04-08 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-08T14:47:55.036Z
- **Completed:** 2026-04-08T14:47:55.036Z
- **Duration:** < 1m
