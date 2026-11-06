---
id: "27b86abd-678f-4f5c-86ae-8618b47ca7c2"
type: "task"
title: "Apply decides from the change's own detail"
slug: "apply-decides-from-the-change-s-own"
description: "Stack review round 2 finding on #967 at packages/web/src/viewer/components/prd-tree/change-apply.ts:65 (review comment 4494324580).\n\n**Should fix: every change detail panel downloads the whole change list to decide whether to show Apply**\n\n`ChangeApplySection` mounts for every change, and each one calls `useRefetchableProductRead(\"/api/rex/changes\", …)` just to find its own row's `stage`. That route runs a full `loadPrdModel` plus `buildChangeRows` for every change, and it refetches on every `rex:prd-changed`. So an open change panel during `ndx work` re-reads it on each write. The detail's `item` already carries `status`, `appliedAt` and `shippedIn`. Derive awaiting-apply locally (completed, no `appliedAt`, no `shippedIn`), or read only that one change. The same code is still at S8."
acceptanceCriteria:
  - "change-apply.ts derives awaiting-apply from the item itself (completed, no appliedAt, no shippedIn) and no longer fetches /api/rex/changes per panel"
  - "A test asserts opening a change's detail makes no /api/rex/changes request and still shows Apply for an awaiting-apply change"
---
