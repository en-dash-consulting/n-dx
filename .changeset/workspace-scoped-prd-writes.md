---
"@n-dx/web": patch
---

Make the dashboard's workspace-scoped PRD writes explicit. The PRD view now shows a one-line strip naming the workspace whenever it is not the anchor ("Workspace <name> · writes go to this worktree's PRD"), so an edit made while viewing a branch worktree states its target rather than leaving it to be inferred from the URL. There is still no cross-workspace write action — switching to the anchor's PRD is a workspace switch. Adds an integration test that hashes both worktrees' trees around a write through `/w/<key>/api/rex/items` and a slot-less write, pinning that each lands in exactly one tree.
