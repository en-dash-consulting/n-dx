---
"@n-dx/rex": patch
---

Add computed edges for the v2 product map (`core/product-edges.ts`): `changedBy` and `boundBy` (inverses of `amends` and `appliesTo`), `coChanges`, `realizedBy` (commits, files and zones of the changes that amended a capability, found by `N-DX-Item` trailer), and the derived change kind (feature, enhancement, retirement, fix, refactor, policy change, spike). A ref that is an alias of a folded id resolves to the node it was folded into. The files per commit are cached in `<rexDir>/.cache/commit-files.json` (gitignored) and rebuilt when missing. v2 is still not wired to the store.
