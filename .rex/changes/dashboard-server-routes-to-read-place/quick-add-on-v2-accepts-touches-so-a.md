---
id: "49203e99-d443-4c3d-be61-a3da08043504"
type: "task"
title: "Quick Add on v2 accepts touches, so a captured change can skip the Inbox"
slug: "quick-add-on-v2-accepts-touches-so-a"
description: "`addInboxChange` in `packages/web/src/server/routes-rex/items.ts` always creates a root change with `needsPlacement: true`. Accept an optional `touches: string[]` on `POST /api/rex/items` for a v2 change. Validate each id resolves to a live capability or constraint (refuse 400 otherwise), create the change through rex's add path (which sets `needsPlacement` only when neither `touches` nor `amends` is given, `core/change-add.ts`), and answer `needsPlacement: false`. Log `change_placed` alongside the add. Amends at capture is out of scope: the viewer adds first, then opens the detail panel (PR 4)."
acceptanceCriteria:
  - "POST /api/rex/items on v2 with touches creates a placed change outside changes/inbox/"
  - "An unknown or non-product id in touches is refused with 400"
  - "Without touches the behaviour is unchanged"
  - "routes-rex-v2-items.test.ts covers both"
priority: "medium"
tags:
  - "inbox-placement"
  - "web"
source: "ndx-capture"
---
