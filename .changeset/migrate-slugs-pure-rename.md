---
"@n-dx/rex": patch
---

Make `rex migrate-slugs` a real rename, and refuse ambiguous trees.

The command was a canonicalizing round-trip: load through the store, save back,
let the serializer write every item at its new path. That moved the files but it
was not a rename — the serializer normalizes as it writes (field order,
`acceptanceCriteria: []` on items that had none), so git scored the moves at
about R081 and a reviewer of an 800-file migration had to read content diffs to
convince themselves nothing else had changed.

Renames now go through `fs.rename`, so leaf files come out byte-identical
(`R100`). Only `index.md` changes content, and only in its children table,
because that table embeds sibling slugs — the one thing a rename must alter.
Items are located by front-matter id rather than by guessing the previous slug
rule, so the command is indifferent to which older build wrote the tree.

It also now refuses to run while two siblings' titles normalise to the same
slug, naming the offending titles. Ordinary writes disambiguate those with a
suffix to avoid losing an item, but a migration whose purpose is readable paths
should not quietly bake a suffix in.

The reported "already canonical" count was wrong: it subtracted the move count
from the total, which classified every `index.md` that moved with its parent
directory as unchanged. It now compares path sets.
