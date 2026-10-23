---
id: "30dbd22d-d325-4345-a66f-a1a8aa6a10f1"
type: "capability"
title: "Single state writer for state.yaml"
slug: "single-state-writer-for-state-yaml"
statement: "Rex keeps all tool state in one committed state.yaml per folder, keyed by item id. A single module reads and writes these files, a merge driver combines them across branches, and the v2 export bundle carries them."
criteria: [{"id":"c1","text":"When the state writer loads a state.yaml file and saves it again, it shall keep any key it does not recognise byte-identical."},{"id":"c2","text":"The state writer shall produce byte-identical state.yaml output for the same input, using a deterministic key order and LF line endings."},{"id":"c3","text":"The state writer shall perform every state.yaml write inside withTransaction, while holding the PRD lock."},{"id":"c4","text":"When a spec edit first makes an item's spec hash differ from its metAt, the state writer shall stamp revisedAt on that item."},{"id":"c5","text":"While an item's spec hash still differs from its metAt, the state writer shall keep the existing revisedAt across later spec edits and state writes."},{"id":"c6","text":"When an item's spec hash equals its metAt again, whether by a re-stamp or a revert to the met text, the state writer shall clear revisedAt."},{"id":"c7","text":"When two branches each add children to the same folder, the rex-state merge driver shall merge their state.yaml rows by item id without a conflict."},{"id":"c8","text":"When both sides of a merge changed an item's metAt, the rex-state merge driver shall recompute metAt from the merged intent instead of picking a side."},{"id":"c9","text":"If nothing decides an item's status during a merge, the rex-state merge driver shall leave conflict markers and an unmerged path in state.yaml."},{"id":"c10","text":"ndx init shall register the rex-state merge driver and pin the rex YAML files, state.yaml included, to LF line endings in .gitattributes."},{"id":"c11","text":"ndx prd export shall write a version 2 bundle envelope that carries both layers, and importing that bundle shall reproduce the tree."},{"id":"c12","text":"rex import-bundle shall accept a v1 bundle and import it into a v2 tree."},{"id":"c13","text":"If the output path is inside the rex directory, ndx prd export shall refuse to write the bundle."},{"id":"c14","text":"When a v2 tree is exported and then imported into an empty v2 tree, rex shall write every top-level state.yaml key other than schema and items back into the same folder's state.yaml."},{"id":"c15","text":"If a bundle's root header fails RootHeaderSchema validation, rex import-bundle shall refuse the bundle before any write and leave the destination tree unchanged."},{"id":"c16","text":"rex shall carry unknown root header keys through export and import unchanged."},{"id":"c17","text":"If a folder that is neither a change nor a node with children has top-level state.yaml keys to carry, rex export shall refuse with a message that names the folder and says how to fix the tree, and shall write no bundle file."},{"id":"c18","text":"Rex export, bundle import and the state writer shall decide what counts as a folder node with one shared predicate, so rex import-bundle never refuses the folderState of a bundle that rex export wrote."}]
tags:
  - "product-map"
  - "pr-08"
  - "lane-rex-store"
  - "rex"
  - "critical-path"
source: "roadmap"
priority: "high"
---

Critical path. One module writes all tool state: one committed state.yaml per folder, keyed by item id.

Roadmap PR 8 · wave 1 · lane rex-store.
