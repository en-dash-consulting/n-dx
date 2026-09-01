---
"@n-dx/rex": patch
---

Make PRD tree slugs title-only, and move merge safety into validation.

Paths now read as prose — `authentication/oauth2-integration/handle-the-callback.md`
— with the item id living in front matter only. Every slug previously carried a
`-<shortId>` suffix.

That suffix existed for a real reason: two same-titled items created on
divergent branches land on identical paths, and a git merge can silently unify
two distinct items. The hazard has not gone away; it is now caught after the
fact rather than prevented by the path. `rex validate` runs the raw-tree
duplicate-id scan by default (previously reachable only under `--post-merge`),
which reports one id appearing at two paths — the signature of exactly that
merge. A guard you have to remember to invoke is not a guard.

A second, closer hazard needed a different answer. Title-only slugs can collide
*locally*: two siblings whose titles normalise to the same string want the same
path, and the second write clobbers the first. `resolveSiblingSlugs` now
suffixes only the entries that actually collide, so the common case stays
readable and the exceptional case stays lossless.

`MAX_SLUG_LENGTH` stays at 40, for path length rather than aesthetics: Windows
caps many paths at 260 characters and the tree nests four levels deep. The
readability win came from dropping the suffix, which gave titles roughly seven
more characters within the same cap.

`rex migrate-slugs` is unchanged mechanically — it re-serializes to whatever the
current rule says — but no longer describes itself as migrating *to*
id-qualified slugs.
