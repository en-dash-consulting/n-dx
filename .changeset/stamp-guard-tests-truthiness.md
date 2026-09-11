---
"@n-dx/rex": patch
---

Stop a null `lastModified` slipping past the stamp repair.

`stampChangedItems` decided an item already had a timestamp with
`!== undefined`, while its only consumer opens with
`if (!meta.lastModified) return false`. So `null` and `""` were "no timestamp"
to the reader and "has one" to the guard, and the repair skipped exactly the
items it exists for.

The consequence was permanent. The frontmatter emitter drops the null, so from
the next load the item reads as pre-existing and unchanged, can never acquire a
stamp, is never pushed to a remote, and is overwritten by the remote's value on
the next pull — the silent sync invisibility this repair was written to prevent,
reached through a different door. `rex export` never emits a null, so it takes a
hand-authored or third-party bundle; the document schema is a passthrough and
never declares the field, so such a bundle validates cleanly on the way in.

Both halves of the stamp now use truthiness, matching the consumer. The author
half had the same split, with a milder cost — a dropped author loses provenance
rather than sync visibility.
