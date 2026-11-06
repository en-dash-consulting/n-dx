---
id: "6ff65e0d-f93c-461d-ba8e-e431189fde85"
type: "task"
title: "A v1 project's first Plan load mounts the v2 tiles before status arrives"
slug: "a-v1-project-s-first-plan-load-mounts"
description: "Verdict: should-fix (from the adversarial review of bbf67764, the rest of review comment 4488636781 on #962).\n\nScenario: open Plan on a v1 project with no cached status (first page load, or before `cachedStatus` in use-project-status.ts is set). `LayoutTileGrid` (packages/web/src/viewer/views/stage-pages.ts:~258) has no known layout, so it renders the v2 tiles (Product, Inbox, Open changes). Their previews mount and fire v2-only requests, then swap to Tasks when status lands.\n\nBbf67764 fixed the later null-after-known case only.\n\nOptions:\n1. Render no layout-dependent tiles (or a placeholder) until the first status arrives; v1-agnostic tiles (Validation) still show. Cheap; brief empty slot on v2.\n2. Embed the PRD layout in the initial HTML or config payload so it is known synchronously. Removes the flash; costs a server change.\nRecommend 1."
acceptanceCriteria:
  - "With status not yet loaded, the Plan stage mounts no v2-only tile (product, inbox, changes)"
  - "A unit test mounts Plan with null status, then a v1 status, and asserts no v2-only tile was rendered at either point"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
