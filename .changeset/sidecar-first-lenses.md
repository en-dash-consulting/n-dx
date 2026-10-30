---
"@n-dx/web": patch
"@n-dx/rex": patch
---

Add the Sidecar's first lenses and carry out its approved calls, all behind `web.sidecar`, which stays off by default.

- An approved or allow-listed `run_command` runs as the workspace's Sidecar command job, shown in the job tray and on Live. The agent waits up to 60 s for it and gets the exit status and the output's last 80 lines (at most 8 KB, saying how much was cut), or hears that the command is still running as its job. A turn stopped while waiting answers at once and leaves the job running.
- A `start_work` card shows the task's `ndx work --resolve` before approval; approval starts the run through the hench execute route and is refused at `guard.maxConcurrentProcesses`. `start_work` now takes the execute route's `options` instead of raw flags.
- Sidecar planning ends in one editable change-set card. A `propose_prd_change` call is read against the PRD before its card is raised: each item's type and parent are resolved, an item that matches an existing one is flagged with the match, and on v2 the card says whether the change lands on its target or in the Inbox needing placement. The operator can edit each item's title, description and done-when. Approval writes the edited items in one transaction under the PRD lock, by the dashboard's own add and placement rules, and the tool result lists the ids written. A denied or withdrawn card writes nothing, and the card never applies a change. While a card waits, the Plan tree shows its items as dimmed "proposed" rows. The duplicate scan yields to the event loop between items, so a large card does not stall the dashboard.
- Other approved tools report "recorded, not carried out yet" and name the batch that will carry them out.
- Settings > Workflow gains a Sidecar section: the allow-list editor (work, reset and push shown locked and refused when added), mode (Ask; Auto locked), the worktree and hub context ceilings, the session idle window (`web.sidecarIdleMs`) and a GitHub reads toggle that nothing reads yet. Nothing is written until Save, and Save checks every staged command before writing any.
- The Explain lens explains a product area, a capability or a sourcevision zone. A capability's packet lists each capability criterion as `met`, `not met` or `not verified` with its evidence, and on a v1 tree the packet says there is no product layer.
- The Describe lens reads the Prepare modal's `ndx work --resolve` and `--dry-run`, started together and cancelled when the turn stops, and carries done-when checks, likely files and the tier with its reason. Its instructions flag vague criteria and propose tighter ones on a change-set card.

Outside the flag: rex exports `findDuplicateItem`, the duplicate rule smart add already used, now shared with the change-set card. Smart add's matches are unchanged.
