---
"@n-dx/hench": patch
---

Stamp `actor` (git `user.name`/`user.email` → OS username → `"unknown"`) and `host` (`os.hostname()`) on every `RunRecord` at run start, for both agent-loop runs and assisted `hench record` runs. Both fields are additive on the v1 schema — existing run files without them still parse. `hench show`/`status` and the run-complete summary surface the actor.
