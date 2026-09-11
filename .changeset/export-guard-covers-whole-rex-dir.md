---
"@n-dx/rex": patch
"@n-dx/core": patch
---

Stop `rex export` from writing an artifact that becomes the PRD backend.

The in-tree guard rejected only paths inside `.rex/prd_tree/`, which is one
directory short of the backends the store still falls back to:
`FileStore.loadDocument` prefers `.rex/prd.md`, then `.rex/prd.json`, whenever
the folder tree is absent.

Two reachable outcomes, both of which the guard's own docblock claimed to
prevent. `rex export --out=.rex/prd.json` passed: a bundle envelope carries
`schema`, `title` and `items`, so it satisfies document validation and silently
*becomes* the PRD on a checkout without the tree. And
`rex export --format=narrative --out=.rex/prd.md` planted prose at the preferred
legacy path, where the markdown parser then throws and blocks every rex command
on that checkout.

The guard now refuses anywhere inside `.rex/`, which is correct rather than
merely wider: nothing is ever legitimately exported into the PRD storage
directory. The bundle and narrative carve-outs in the project guidance are
reworded to match what the code actually enforces.
