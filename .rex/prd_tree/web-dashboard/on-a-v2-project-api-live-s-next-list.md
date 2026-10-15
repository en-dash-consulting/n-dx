---
id: "99e076e5-3c23-4243-b897-2a640d8e41a7"
level: "task"
title: "On a v2 project /api/live's next list uses v1 selection, so it shows Inbox changes and ignores change priority"
status: "pending"
priority: "medium"
tags:
  - "web"
  - "v2"
  - "live"
  - "rex"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "On a v2 project, `/api/live`'s `next` is built with the v2 work selector rather than v1 `findNextTask`"
  - "An Inbox change — one not yet placed — does not appear in `next` on a v2 project"
  - "`next` honours change priority on a v2 project"
  - "v1 projects select exactly as they do today"
  - "A test drives the v2 fixture and asserts the list, so the Inbox entry cannot come back"
description: "Raised by @ryrykeith reviewing #742, and explicitly flagged there as not that PR's defect — it is adjacent, and surfaced because the queued list now renders beside `next`.\n\n`packages/web/src/server/routes-live.ts` builds `next` (around line 421) with v1 `findNextTask` over the v2 projection. On a v2 project that is the wrong selector: it lists Inbox changes, which are changes that have not been placed yet and are not work anyone should pick up, and it ignores change priority.\n\nObserved on the v2 fixture, `next` came back as:\n\n    [Tidy logs, Do it (Inbox), Wire the button, Inner step]\n\nThe suggested fix is to go through the rex gateway's `findNextWork` when the layout is v2, which is the selector that understands changes, placement state and change priority. `routes-live-task.ts` now resolves the layout for the task snapshot (added in #742), so there is a precedent for getting the layout into this route.\n\nWorth checking while in there whether anything else in `routes-live.ts` selects work with v1 semantics on a v2 tree."
lastModified: "2026-10-15T18:11:02.900Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
