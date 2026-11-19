---
"@n-dx/web": patch
---

The dashboard's Plan page shows how planning works as five steps (capture, place, ready, work, apply) and marks the one to do next.

Each step says in one line what you do there and links to where it is done: the capture bar, the Inbox, Open changes filtered to Proposed or Awaiting apply, and Work with rex's next pick selected. The highlighted step follows the project's open changes: changes awaiting apply come first (under `rex.applyOn: release` they rank last and wait for the next `rex release`), then Inbox changes waiting for a place, then work (changes marked ready, work in progress, or rex's next pick), and only then placed changes not marked ready, where it asks for an automated requirement while some open change has none and otherwise for `rex ready`; with nothing open it points at capture. The band sits above the lifecycle counts on v2 projects; a v1 tree has no Inbox or apply, so it is not shown there.
