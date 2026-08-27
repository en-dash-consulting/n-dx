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

## Children

| Title | Status |
|-------|--------|
| [Implement language-scoped ArchetypeSignal schema and add Go signals to archetypes](./implement-language-scoped-7cbffe.md) | completed |
| [Write archetype classification tests for Go projects](./write-archetype-classification-4cba12.md) | completed |
