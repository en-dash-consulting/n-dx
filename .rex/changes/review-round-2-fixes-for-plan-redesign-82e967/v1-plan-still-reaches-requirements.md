---
id: "2bbebad7-f4c6-4cde-abd3-700d834cc27b"
type: "task"
title: "v1 Plan still reaches Requirements"
slug: "v1-plan-still-reaches-requirements"
description: "Stack review round 2 finding on #962 at packages/web/src/viewer/views/stages.ts:214 (review comment 4494323575).\n\n**Should fix: making Product `v2Only` takes Requirements away from v1 projects again**\n\nIn #961 a v1 project reaches the Requirements view through Plan's `product` section: 634c6ef2a wraps `NoProductLayer` in the Product tabs. Here the Product tile becomes `v2Only`, and `v1Tiles` is only `[{ view: \"prd\" }]`, so on v1 Plan draws Tasks and Validation and nothing that leads to Requirements. That is the round-1 #961 finding again, now through the stack tip. Fix: either keep a v1 tile that opens the Product page (its tablist already handles v1), or add `requirements` to `v1Tiles`. Add a v1 test that reaches Requirements from Plan."
acceptanceCriteria:
  - "On a v1 project Plan offers a way to Requirements: a v1 tile that opens the Product page (whose tablist already handles v1) or requirements in v1Tiles"
  - "A v1 test reaches Requirements from Plan"
---
