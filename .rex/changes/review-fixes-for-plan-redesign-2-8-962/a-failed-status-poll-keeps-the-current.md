---
id: "bbf67764-309c-428a-b7f9-0a421dbe3a66"
type: "task"
title: "A failed status poll keeps the current tile set"
slug: "a-failed-status-poll-keeps-the-current"
description: "Stack review finding on #962 at packages/web/src/viewer/views/stage-pages.ts:257 (review comment 4488636781).\n\n**Should fix: a v1 project swaps its whole tile set whenever a status poll fails**\n\n`layout` comes from `useProjectStatus()?.rex.layout`. When `/api/status` fails, during a server restart for example, `fetchStatus` returns null and `refresh` calls `setStatus(null)`. A v1 project then flips from [Tasks, Validation] to the v2 Product, Inbox and Open changes tiles, and back on the next good poll. That unmounts the Tasks tree and loses its expansion, scroll and selection. If Tasks was full-screen, its `prd` key matches no v2 tile, so the modal closes. With no cached status on a first load, a v1 project also mounts the v2 previews first, and they fire v2-only requests.\n\nFix: keep the last known layout in a ref so an unknown status keeps the current tile set. Add a test that drops status to null after a v1 load."
acceptanceCriteria:
  - "The stage page keeps the last known rex layout in a ref, so a null or failed status does not swap v1 and v2 tiles"
  - "A test loads a v1 project, drops status to null, and asserts the v1 tiles stay"
---
