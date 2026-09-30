---
"@n-dx/core": patch
---

Add `ndx migrate-layout`, which moves an already-initialized project from the
legacy layout (`.rex/`, `.hench/`, `.sourcevision/` and five loose `.n-dx*`
files at the project root) onto the `.ndx/` container.

Migrating is optional — every command reads either shape, and `ndx init`
deliberately leaves an initialized project on the layout it has. This is how you
move when you choose to.

The result is renames plus two dotfiles. Each path moves on disk and both ends
are staged, so `git log --follow` still reaches the history; `.gitignore` and
`.gitattributes` are rewritten so their patterns name the new paths, because a
`.rex/**` eol pin matches nothing once the PRD lives in `.ndx/rex/`. The move is
then verified — every path arrived, and `rex validate` gives the same answer it
gave before — and a failed check restores the project to the legacy layout
without committing anything. Running it on a project already on `.ndx/` is a
no-op.

`--dry-run` prints the moves and changes nothing; `--no-commit` stages the
migration and leaves the commit to you.

Two details are load-bearing and worth stating. The move is a rename plus
`git add -A` on both paths rather than `git mv`: git stores no rename records —
`--follow` and the `R` status are diff-time similarity detection — so the commit
is byte-identical, and `git mv <dir>` aborts the whole directory over any single
tracked entry missing from the working tree, which is an ordinary mid-work state
rather than a corrupt repository. That trade is only safe with the second
detail: the command refuses to commit when anything under the migrated paths is
uncommitted, so an in-progress PRD edit cannot be swept into a commit advertised
as nothing but renames. `--no-commit` lifts that refusal.

Nothing in the command names a directory. The move list and the pattern
rewrites are both derived by resolving the same project root under both layout
modes and pairing the fields, so a path added to the resolver joins the
migration rather than being silently left behind at the root.
