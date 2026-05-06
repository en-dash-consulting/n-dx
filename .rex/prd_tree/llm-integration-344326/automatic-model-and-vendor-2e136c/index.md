---
id: "2e136c81-64ea-4b4f-96ad-d070f98665e1"
level: "feature"
title: "Automatic Model and Vendor Failover on Run Errors"
status: "pending"
source: "smart-add"
acceptanceCriteria: []
description: "Add an opt-in config flag that, when a hench run hits a model failure (quota exhausted, rate limit, auth error, etc.), transparently retries the run on a fallback chain of models — first within the active vendor, then crossing to the other vendor — before surfacing the original error. Defaults to off so existing behavior is unchanged."
---

# Automatic Model and Vendor Failover on Run Errors

 [pending]

## Summary

Add an opt-in config flag that, when a hench run hits a model failure (quota exhausted, rate limit, auth error, etc.), transparently retries the run on a fallback chain of models — first within the active vendor, then crossing to the other vendor — before surfacing the original error. Defaults to off so existing behavior is unchanged.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Add llm.autoFailover config flag with schema, loader, and ndx config surface | task | pending | 1970-01-01 |
| Define vendor-specific failover chains and selection policy in llm-client | task | pending | 1970-01-01 |
| Integrate failover loop into hench run with original-config restore and error parity | task | pending | 1970-01-01 |

## Info

- **Status:** pending
- **Level:** feature
