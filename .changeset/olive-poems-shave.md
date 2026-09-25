---
"@n-dx/rex": patch
---

`rex validate --post-merge` reports a `## Children` table that disagrees with its own directory

A feature reached `main` with four children missing from its Children table and was repaired by hand twice before anything noticed. A fixture test now settles what that state costs: nothing. The parser walks the directory and never reads the table, so the omitted items load normally, survive a full-tree save, and the save rewrites the table complete. The shape is cosmetic — but it still makes the tree lie to anyone reading it as documentation, and it was invisible.

`children-table-out-of-sync` reports it, in both directions (a child on disk that no row lists, and a row pointing at a file that is gone). It is repairable — `--repair` rewrites the table from the directory — so the CI gate reports it without blocking the merge.

Two corrections came out of building it. Link targets are read as each row's last `](…)` rather than by matching a `[label](target)` pair, because titles are not escaped into the label and a real item titled "Color-code [Tool], [Agent], …" would otherwise read as unlisted. And the tree-root banner `index.md` written by `rex init` is skipped, since it has no frontmatter and is not an item — every epic in the tree would otherwise read as an unlisted child of it.

`docs/architecture/prd-folder-tree-schema.md` said tasks never carry a Children table (contradicting its own compatibility matrix and the serializer) and described the child link format as `./{slug}/{title}.md` (the serializer writes `./{slug}.md` or `./{slug}/index.md`). Both corrected.
