---
id: "761ab00d-e31b-4e8a-9c86-a4bde4584471"
level: "task"
title: "Rename the map layer to product in the v2 types"
status: "pending"
priority: "high"
tags:
  - "pr-27"
  - "lane-rex-store"
  - "rex"
source: "roadmap"
acceptanceCriteria:
  - "No identifier, string literal or comment in the v2 schema module or its tests refers to a map layer or map node"
  - "layerOf returns \"product\" for area, capability and constraint (test)"
  - "The v2 schema tests pass"
description: "Decision N1: \"map\" is renamed \"product layer\" everywhere, because n-dx already has a codebase map and an isometric map. In packages/rex/src/schema/v2.ts: Layer = \"product\" | \"changes\", MapNodeType → ProductNodeType, MAP_NODE_TYPES → PRODUCT_NODE_TYPES, layerOf returns \"product\", and every comment and test that says map layer or map node. Storage root, CLI and MCP names follow in their own PRs (.ndx/rex/product/, rex product, get_product)."
lastModified: "2026-10-06T16:54:39.845Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
