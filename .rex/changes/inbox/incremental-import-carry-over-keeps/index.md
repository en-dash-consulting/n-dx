---
id: "f6f0d98c-c5d3-49a1-8cd9-b5c8d20e909f"
type: "change"
title: "Incremental import carry-over keeps edges to inventoried package directories"
slug: "incremental-import-carry-over-keeps"
intent: "In `buildIncrementalState` accept an edge target that is an inventoried file or the parent directory of one. Regression test under `packages/sourcevision/tests/integration/`: go.mod `module example.com/app`, main.go and other.go importing example.com/app/util, util/util.go; incremental run with changedFiles={main.go}, fileSetChanged=false must equal the full run; and with util/ dropped from the inventory the edges to `util` are dropped. Test file name must not collide with the stack's `imports-go-incremental.test.ts`."
acceptanceCriteria:
  - "Incremental run with changedFiles={main.go} returns both main.go->util and other.go->util, equal to the full run."
  - "With util/util.go removed from the inventory, no carried-over edge targets util."
  - "Edges from files no longer inventoried are still dropped."
priority: "high"
tags:
  - "sourcevision"
  - "imports"
  - "incremental"
  - "go"
source: "ndx-capture"
---
