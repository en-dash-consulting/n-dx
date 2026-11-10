---
id: "499952e1-ad0c-467e-ab12-ac9c12851464"
type: "task"
title: "Create in tracker shows a refused or unreachable create"
slug: "create-in-tracker-shows-a-refused-or"
description: "Stack review round 2 finding on #988 at packages/web/src/viewer/components/tracker-card-form.ts:59 (review comment 4494325585).\n\n**Should fix: Create in tracker on a change row closes silently when the tracker refuses the create or can't be reached**\n\n`decideOnce` answers `{ ok: true, entry }` for every approved call, including `result: \"refused\"`, `\"unavailable\"` and `\"needs-sign-in\"`, so `if (res.ok) onDone();` closes the form. On a row, `CreateInTrackerButton`'s `onDone` (tracker-chip.ts:152) then shows the button again with no error. A refused create, or a connection that is down, looks like nothing happened, and the reason is only in Live's activity log. That was fine in Live, where the row shows the result, but S8 puts this form on rows that show no log. The same gap hides an `ok` create whose link failed (for example under `ndx work`'s PRD lock). The chip then shows no link, Create is refused with 409, and nothing tells the operator to link by hand.\n\nFix: in `send`, read `entry.result` and `entry.problems`. Keep the form open and show the problems unless the result is `ok`/`duplicate` with none. Add a tracker-chip test that approves with a refused entry."
acceptanceCriteria:
  - "tracker-card-form.ts send reads entry.result and entry.problems, and keeps the form open showing the problems unless the result is ok or duplicate with no problems"
  - "When an ok create's link failed, the form says to link by hand"
  - "A tracker-chip test approves with a refused entry and asserts the form stays open with the problem"
---
