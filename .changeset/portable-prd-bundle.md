---
"@n-dx/rex": patch
"@n-dx/core": patch
---

Add a portable PRD bundle: `ndx prd export` / `ndx prd import`.

A PRD can now be carried between machines as a single JSON file, without
sharing the repo or configuring a remote adapter. `rex export --out=<path>`
serializes the whole loaded document; `rex import-bundle --in=<path>` rebuilds
`.rex/prd_tree/` from it. The orchestrator exposes both as an `ndx prd`
subcommand group; `ndx export`, the static-dashboard exporter, is unchanged.

Fidelity is the point — a round trip preserves item ids, hierarchy, level,
status, priority, description, acceptance criteria, tags, `blockedBy` edges,
source, and attribution metadata. Verified against a 1392-item PRD with no
field, parent, or membership differences.

The bundle carries the PRD `SCHEMA_VERSION`. Import gates on it more strictly
than the store's read path does: a bundle from a newer rex (newer envelope
version, newer schema minor, or a different major) is refused before anything
is written, rather than imported partially. `isCompatibleSchema` keeps its
forward-compatible behaviour for ordinary loads.

Import has a defined collision policy instead of last-writer-wins. `--merge`
(the default) is additive: local items keep their content and placement, new
bundle items are grafted onto the matching parent, an id that already exists
anywhere in the tree is reported rather than duplicated, and ids whose content
differs are listed with the local copy kept. `--replace` discards the local
tree and needs confirmation, or `--yes` when not on a terminal. The tree write
runs inside `store.withTransaction`, so it holds the PRD lock across the whole
read-modify-write and cannot lose a concurrent writer's items.

The bundle is a transport artifact, not a PRD backend: writing one inside
`.rex/prd_tree/` is refused in code, and the PRD invariant — the folder tree is
the sole writable PRD surface — is documented with an explicit carve-out.

The rex-side importer is named `import-bundle` because `rex import` is a
long-standing alias for `rex analyze`.
