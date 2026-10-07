---
id: "16a680ad-40ec-43d6-a8ea-2eedbc3e0e77"
level: "feature"
title: "Read and write the v2 folder trees"
status: "pending"
priority: "high"
tags:
  - "product-map"
  - "pr-09"
  - "lane-rex-store"
  - "rex"
  - "critical-path"
blockedBy:
  - "30dbd22d-d325-4345-a66f-a1a8aa6a10f1"
  - "8b38b308-be40-4cb1-9f92-ee0233f0b8ac"
source: "roadmap"
startedAt: "2026-10-07T19:07:27.459Z"
endedAt: "2026-10-07T19:07:27.459Z"
acceptanceCriteria: []
description: "Critical path. Dual-read keeps main working on the v1 tree while v2 code lands. Run with the strongest model tier and --review.\n\nRoadmap PR 9 · wave 1 · lane rex-store."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-07T19:41:13.689Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [A null or non-object run in v2 frontmatter fails the whole node's intent parse](./a-null-or-non-object-run-in-v2.md) | completed |
| [Keep a moved node's unknown state fields in state.yaml](./keep-a-moved-node-s-unknown-state.md) | pending |
| [Parse the v1 tree and the v2 product and changes roots into one model](./parse-the-v1-tree-and-the-v2-product.md) | completed |
| [Schema-skew write refusal on v2 trees depends on writers calling assertPrdModelWritable](./schema-skew-write-refusal-on-v2-trees.md) | completed |
| [v2 reader lets state fields written in frontmatter (status, completedAt…) stand in for state.yaml](./v2-reader-lets-state-fields-written-in.md) | completed |
| [Write the v2 trees with frozen slugs and no Children tables](./write-the-v2-trees-with-frozen-slugs.md) | completed |
| [Reject Windows-reserved and Windows-invalid slugs before the v2 writer writes anything](./reject-windows-reserved-and-windows.md) | pending |
