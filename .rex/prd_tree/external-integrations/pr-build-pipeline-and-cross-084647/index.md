---
id: "08464700-9955-4338-87b6-afea0646a6f8"
level: "feature"
title: "PR Build Pipeline and Cross-Platform CLI Validation"
status: "completed"
source: "smart-add"
startedAt: "2026-04-07T14:28:53.235Z"
completedAt: "2026-04-07T14:28:53.235Z"
acceptanceCriteria: []
description: "Extend the existing PR validation pipeline with additive cross-platform execution stages that run the same n-dx install and smoke-command flow in MacOS and Windows containerized environments, then verify parity against each other and against the repository's existing static expected responses and exit codes."
---

# PR Build Pipeline and Cross-Platform CLI Validation

 [completed]

## Summary

Extend the existing PR validation pipeline with additive cross-platform execution stages that run the same n-dx install and smoke-command flow in MacOS and Windows containerized environments, then verify parity against each other and against the repository's existing static expected responses and exit codes.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Add MacOS pipeline stage for ndx install-and-run smoke validation | task | completed | 2026-04-07 |
| Add Windows pipeline stage for ndx install-and-run smoke validation | task | completed | 2026-04-07 |
| Implement cross-platform parity assertions for deterministic CLI responses | task | completed | 2026-04-06 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-04-07T14:28:53.235Z
- **Completed:** 2026-04-07T14:28:53.235Z
- **Duration:** < 1m
