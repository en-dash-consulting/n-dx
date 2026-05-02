---
id: "c9447ae6-7521-40b0-997d-b56bfaa1993a"
level: "feature"
title: "Feature 1: Go-Aware Archetype System"
status: "completed"
source: "smart-add"
startedAt: "2026-03-26T08:06:08.926Z"
completedAt: "2026-03-26T08:06:08.926Z"
acceptanceCriteria: []
description: "Add Go-specific signals to the existing archetype definitions in `packages/sourcevision/src/analyzers/archetypes.ts` and add a `languages` field to `ArchetypeSignal` in `packages/sourcevision/src/schema/v1.ts` so signals can be scoped to specific project languages. React-specific archetypes (`route-module`, `component`, `hook`, `page`) should not fire for Go projects."
---

# Feature 1: Go-Aware Archetype System

 [completed]

## Summary

Add Go-specific signals to the existing archetype definitions in `packages/sourcevision/src/analyzers/archetypes.ts` and add a `languages` field to `ArchetypeSignal` in `packages/sourcevision/src/schema/v1.ts` so signals can be scoped to specific project languages. React-specific archetypes (`route-module`, `component`, `hook`, `page`) should not fire for Go projects.

## Progress

| Child | Level | Status | Last Updated |
|-------|-------|--------|--------------|
| Implement language-scoped ArchetypeSignal schema and add Go signals to archetypes | task | completed | 2026-03-26 |
| Write archetype classification tests for Go projects | task | completed | 2026-03-26 |

## Info

- **Status:** completed
- **Level:** feature
- **Started:** 2026-03-26T08:06:08.926Z
- **Completed:** 2026-03-26T08:06:08.926Z
- **Duration:** < 1m
