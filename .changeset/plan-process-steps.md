---
"@n-dx/web": patch
---

The dashboard's Plan page shows how planning works as five steps (capture, place, ready, work, apply) and marks the one to do next.

Each step says in one line what you do there and links to where it is done: the capture bar, the Inbox, Open changes filtered to Proposed or Awaiting apply, and Work with rex's next pick selected. The highlighted step follows the project's open changes: changes awaiting apply come first, then Inbox changes waiting for a place, then changes ready to run, then placed changes that cannot run yet, then work in progress; with nothing open it points at capture. The band sits above the lifecycle counts on v2 projects; a v1 tree has no Inbox or apply, so it is not shown there.
