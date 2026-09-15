---
"@n-dx/rex": patch
---

fix(rex): stale-save guard no longer fires on same-writer leaf promotions

Root cause of the intermittent web-route 400s (`capture-next-steps`,
`capture-ask`, `accept-edited` flaking under the full suite): the stale-save
guard judged deletions by mtime alone. When a handler adds an epic and then
its first child in back-to-back transactions, the promotion from `<slug>.md`
to `<slug>/index.md` removes a file the same writer created milliseconds
earlier — and under Windows timestamp granularity that leaf's mtime can
postdate the second transaction's load, so the guard vetoed a save that
deleted nothing and the route returned 400.

The guard now flags an entry only when it contains a file that is both newer
than the load AND carries an item id absent from the document being saved —
a relocation keeps its item, a genuine concurrent write does not. Newer files
with no parseable id stay protected by mtime alone, and directory mtimes are
ignored (they bump on any child rename and identify nothing). All existing
guard contracts hold; the promotion case and the id-absent case are pinned by
new tests with the pathological clock frozen in place via `utimes`.
