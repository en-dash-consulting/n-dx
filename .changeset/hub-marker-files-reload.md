---
"@n-dx/core": minor
"@n-dx/web": patch
---

`ndx start --hub` now writes `.n-dx-web.port` (the hub's port) and `.n-dx-web.pid` (`{ pid, port, startedAt, via: "hub", projectId }`) in the started directory, so `ndx refresh --live-server` keeps working unchanged: its reload signal reaches the hub, which forwards it to the project's own server. The reload body now carries `dir`; with several projects registered the hub matches it against each project's repository root and worktrees (deepest match wins), answering 409 without a directory and 404 for an unregistered one. `ndx start stop`, `ndx start status` and refresh's pre-flight recognise the hub marker and never stop the hub through it; `ndx start --here` over a marker takes the files over instead of killing the hub.
