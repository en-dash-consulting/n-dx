---
id: "8b38b308-be40-4cb1-9f92-ee0233f0b8ac"
type: "capability"
title: "Correct the v2 schema before files are written"
slug: "correct-the-v2-schema-before-files-are"
statement: "The v2 rex schema declares level-of-effort fields, saved run settings and discovery provenance on task and change intent, reserves an effort field, and names its two layers product and changes."
criteria: [{"id":"c1","text":"The v2 schema shall declare loeRationale as a string and loeConfidence as one of low, medium or high on task and change intent, beside loe."},{"id":"c2","text":"The v2 schema shall reserve effort with no shape and list it with hypotheses and links among its reserved fields."},{"id":"c3","text":"The v2 schema shall declare run on task and change intent as a loose object whose known keys come from RUN_SETTING_KEYS."},{"id":"c4","text":"The v2 writers shall never write an empty run block ({})."},{"id":"c5","text":"If a task carries a malformed run block or one from a newer version, the PRD store shall round-trip the block unchanged with a warning, and every other PRD write shall still succeed."},{"id":"c6","text":"When a writer receives an invalid run block, the writer shall reject it with the message from validateRunSettings."},{"id":"c7","text":"When a v1 task with a run block is mapped to v2, the mapping shall produce a v2 task that carries the same run block."},{"id":"c8","text":"The v2 schema shall accept an optional discoveredFrom field on change intent that holds an optional item id (a change or task) and an optional hench run id."},{"id":"c9","text":"The v2 schema shall define the layers as product and changes, with no map layer."},{"id":"c10","text":"When given an area, capability or constraint, layerOf shall return \"product\"."}]
tags:
  - "product-map"
  - "pr-27"
  - "lane-rex-store"
  - "rex"
  - "critical-path"
source: "roadmap"
priority: "high"
---

Two schema corrections that must land after the v2 types (PR 7) and before the state writer and the v2 tree writer (PRs 8 and 9) put anything on disk, because the schema freezes at 1.0.0. Small, single-lane, strongest tier with --review.

Roadmap PR 27 · wave 1 · lane rex-store.
