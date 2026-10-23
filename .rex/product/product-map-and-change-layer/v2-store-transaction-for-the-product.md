---
id: "abd05895-1b96-4798-bfb8-8e4b66fca049"
type: "capability"
title: "v2 store transaction for the product and change layers"
slug: "v2-store-transaction-for-the-product"
statement: "The rex store provides a v2 transaction that takes the PRD lock, loads the product and change layers, runs the caller's mutation and writes the result. It refuses a v1 tree."
criteria: [{"id":"c1","text":"When a v2 mutation runs through the store transaction, the store shall hold the PRD lock from load through mutation to write."},{"id":"c2","text":"While one writer holds the v2 store transaction, a concurrent writer shall wait for the lock instead of dropping the other writer's change."},{"id":"c3","text":"If the v2 store transaction is called on a v1 tree, the store shall refuse it with a message that names the layout."},{"id":"c4","text":"The v2 isolation test shall report as an offender any runtime source module outside the v2 module set that imports store/prd-model-transaction."}]
requirements: [{"id":"abd05895-1b96-4798-bfb8-8e4b66fca049:c1","title":"When a v2 mutation runs through the store transaction, the store shall hold the PRD lock from load through mutation to write","description":"Linked to: packages/rex/tests/unit/store/prd-model-transaction.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["When a v2 mutation runs through the store transaction, the store shall hold the PRD lock from load through mutation to write."]},{"id":"abd05895-1b96-4798-bfb8-8e4b66fca049:c2","title":"While one writer holds the v2 store transaction, a concurrent writer shall wait for the lock instead of dropping the other writer's change","description":"Linked to: packages/rex/tests/unit/store/prd-model-transaction.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["While one writer holds the v2 store transaction, a concurrent writer shall wait for the lock instead of dropping the other writer's change."]},{"id":"abd05895-1b96-4798-bfb8-8e4b66fca049:c3","title":"If the v2 store transaction is called on a v1 tree, the store shall refuse it with a message that names the layout","description":"Linked to: packages/rex/tests/unit/store/prd-model-transaction.test.ts","category":"technical","validationType":"automated","acceptanceCriteria":["If the v2 store transaction is called on a v1 tree, the store shall refuse it with a message that names the layout."]}]
tags:
  - "product-map"
  - "pr-31"
  - "lane-rex-store"
  - "rex"
  - "critical-path"
source: "roadmap"
priority: "high"
---

A store API that takes the PRD lock, loads the v2 product and change layers, runs the caller's mutation and writes the result, refusing a v1 tree. PRs 16, 10 and 11 left v2 logic pure (it returns a new tree and writes nothing); this is the write path PR 17 (MCP) and PR 18 (CLI) both need. Its own PR from main, ahead of PR 17 (decided 2026-10-08). Run with claude-opus-5-5 for run and review.

Roadmap PR 31 · wave 2 · lane rex-store.
