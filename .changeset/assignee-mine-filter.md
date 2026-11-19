---
"@n-dx/web": patch
---

The Inbox and the Changes page open on your own items when you have open work assigned, with an "Assigned to" filter for Mine, All or one person.

"You" is the identity `ndx work --mine` uses (git `user.name` and `user.email`), matched by email. A change counts as someone's when it or any of its open tasks is assigned to them, as `ndx work --mine` selects a task by its own assignee; change rows from `GET /api/rex/changes` now carry `taskAssignees` for this. With nothing open assigned to you, the filter starts on All. The lists wait for the people list before showing rows, so they open on the right choice rather than switching from All to Mine, and the Inbox page's first selected change comes from the filtered queue. The filter only hides rows: switching to All shows every item again, lists keep their order, and Apply all still counts every waiting change.
