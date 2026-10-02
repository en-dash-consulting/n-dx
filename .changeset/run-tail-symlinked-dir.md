---
"@n-dx/web": patch
---

Run tail routes no longer serve files through a symlinked `.run-logs/` or `.hench/` directory. A repository can commit `.run-logs` as a link to anywhere (for example `~/.ssh`), which used to move the allowed area there; such a request now answers 404 like any other refused path.
