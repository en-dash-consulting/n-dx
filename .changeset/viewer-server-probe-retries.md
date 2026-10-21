---
"@n-dx/web": patch
---

The dashboard no longer shows "Drop .sourcevision files" when its server answers but will not serve it. The viewer's first `/data` request used to be one-shot, and any non-200 — including the hub's 503 while `ndx start` was still bringing the project server up — put the tab into file-drop mode, asking for files the server already had. The viewer now retries `/data` for about ten seconds, keeps re-probing an unavailable server every five seconds and loads as soon as it answers, and in the meantime says what happened: a project server still starting, a 401 on a missing or rotated token (open the URL `ndx start` printed), a 421 on the wrong host, or a 409 on a hub root shared by several projects. File drop is offered only when nothing serves `/data` at all (a `file://` open or a 404).
