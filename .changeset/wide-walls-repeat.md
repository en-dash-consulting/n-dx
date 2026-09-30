---
"@n-dx/core": patch
"@n-dx/hench": patch
"@n-dx/llm-client": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
---

`ndx init` now starts new projects on the `.ndx/` layout

A project with no n-dx state gets a single `.ndx/` container holding `rex/`,
`hench/`, `sourcevision/` and `config.json`, instead of three dot-directories
and a `.n-dx.json` scattered across the root. `.mcp.json` stays at the
repository root, because the vendor CLIs read it there.

A project that already has n-dx state keeps the layout it has. Re-running init
is how people pick up new assistant surfaces and repaired config, and it must
not turn into a migration nobody asked for — moving an existing project is
`ndx migrate-layout`'s job, where it can snapshot first and `git mv` so history
follows.

The mechanism is that init creates the container before it spawns the sub-CLIs,
so each one resolves its own paths and they cannot disagree. Alongside it, the
paths that `ndx init` writes and that every later command reads now come from
the resolver rather than from literals: the project and package config files,
the `requireInit` check, the `.gitignore` and `.gitattributes` blocks, the git
baseline commit, and hench's own state directory across its CLI.

`relativeToRoot(layout, path)` is new in `@n-dx/llm-client` (and its
orchestration-tier twin), for the several places that need a resolved path as
`.gitignore` spells it — root-relative, forward slashes.
