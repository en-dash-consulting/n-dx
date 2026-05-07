---
id: "2e136c81-64ea-4b4f-96ad-d070f98665e1"
level: "feature"
title: "Automatic Model and Vendor Failover on Run Errors"
status: "completed"
source: "smart-add"
startedAt: "2026-05-06T15:06:45.552Z"
completedAt: "2026-05-06T15:06:45.552Z"
endedAt: "2026-05-06T15:06:45.552Z"
acceptanceCriteria: []
description: "Add an opt-in config flag that, when a hench run hits a model failure (quota exhausted, rate limit, auth error, etc.), transparently retries the run on a fallback chain of models — first within the active vendor, then crossing to the other vendor — before surfacing the original error. Defaults to off so existing behavior is unchanged."
---

# Automatic Model and Vendor Failover on Run Errors

 [completed]

## Summary

Add an opt-in config flag that, when a hench run hits a model failure (quota exhausted, rate limit, auth error, etc.), transparently retries the run on a fallback chain of models — first within the active vendor, then crossing to the other vendor — before surfacing the original error. Defaults to off so existing behavior is unchanged.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Add llm.autoFailover config flag with schema, loader, and ndx config surface | task | completed | 2026-05-06 |
| Define vendor-specific failover chains and selection policy in llm-client | task | completed | 2026-05-06 |
| Integrate failover loop into hench run with original-config restore and error parity | task | completed | 2026-05-06 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-05-06T15:06:45.552Z
- **Completed:** 2026-05-06T15:06:45.552Z
- **Duration:** < 1m
