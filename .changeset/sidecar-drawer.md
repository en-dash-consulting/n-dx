---
"@n-dx/web": patch
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

Add the Sidecar drawer behind `web.sidecar`, which stays off by default. With it on, a top-nav Sidecar button (⌘J) docks a resizable drawer beside every page: a transcript that resumes from its cursor after a reload, a composer with Stop, an agent picker fed by `/api/llm/catalog`, and tool calls that expand to their raw input and result.

- Permission cards are decided in order, oldest first, with an orange paused bar while the agent waits, ⌘↵ / ⌘⌫, a deny note sent to the agent, "Always allow" only where a call can be allow-listed, and a command card's effects from the command manifest with layout paths expanded. Ending a session withdraws its waiting cards, drawn as denied with "session ended". A top-nav badge counts waiting cards.
- The drawer names a missing vendor CLI with its install command, and a signed-out one with its login command, which survives a reload.
- Sessions take a target and can be renamed or re-lensed through `PATCH /api/sidecar/sessions/:id`; the lens packet now opens a session's first turn as well as a refreshed one. `GET /api/sidecar/lenses` lists each lens and whether it is available.
- A sessions list shows each session's branch, lens, model, turns, cost and waiting cards, with Resume, Rename and End, for this worktree or all of them.
- The drawer attaches the current page's item, including a task picked in the Tasks tree, and picks its lens; a lens that is not built yet shows "not available yet" and the session runs General.
- Each finished turn writes a `sidecar` line, with its lens, to the dashboard usage ledger, and LLM Utilization shows Sidecar spend as its own bucket.

Outside the flag: Claude tool results now reach hench runs as well as the Sidecar. The session driver turns each `tool_result` block on a Claude stream-json `user` line into its own event carrying the call's id, and hench records each result on the call it names without changing turns, completion or token totals. The dashboard's status dock drops the worktrees pill, and the uncommitted-files warning becomes an orange "N uncommitted" chip in the bottom bar that opens the same commit panel.
