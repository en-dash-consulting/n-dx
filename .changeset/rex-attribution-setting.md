---
"@n-dx/rex": patch
"@n-dx/core": patch
---

New `rex.attribution` setting (`full`, `name` or `none`) controls what PRD writes stamp as `lastModifiedBy`. Set it with `ndx config rex.attribution none .`.

`full`, the default, keeps today's git `Name <email>` stamp. `name` writes only git `user.name`, and writes nothing when git has only an email. `none` writes no author, but `lastModified` is still stamped. The setting covers every writer: the CLI, MCP, the dashboard and the v2 `state.yaml` path. Rex reads it from `.rex/config.json`, then the `rex` section of `.n-dx.json`, then `.n-dx.local.json`, so one machine can turn it off without changing the repository. Stamps already written stay as they are. A node edited under `none` keeps its previous author. Rex refuses a write while the setting holds any other value. Entries in `execution-log.jsonl` still record the full actor.
