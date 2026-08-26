---
"@n-dx/core": patch
---

`ndx config <key>` no longer lets a same-named directory shadow the key at the pre-dispatch layer.

The config handler already resolved the ambiguity correctly — a known config key beats a directory, because a key is an exact match against a closed set while a directory name is arbitrary — but the pre-dispatch resolver (`resolveExistingDir`, which decides where to read `.n-dx.json` and check initialization) still used disk existence alone. In a project containing a `hench/` subdirectory, `ndx config hench` read config from `./hench` (silently dropping command timeouts and experimental flags, since the missing `.n-dx.json` falls back to `{}`) and printed "Project setup incomplete" for a fully initialized project.

`resolveExistingDir` now accepts a skip predicate and, for the `config` command, applies the handler's own exported `isConfigKey` tiebreaker — so both layers agree. `./hench` and `../hench` remain unambiguous ways to name the directory, and a trailing directory argument in `ndx config <key> <value> <dir>` still resolves.
