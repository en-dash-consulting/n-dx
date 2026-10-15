---
"@n-dx/rex": patch
---

`rex migrate-slugs` now describes the slug rule it actually implements. Its
`rex --help` summary and the JSDoc beside it still named the unconditional
`-{id6}` rule that slug rule 2 replaced, so the command read as a whole-tree
migration to a different convention. Both are now derived from one
`SLUG_RULE_SUMMARY` constant that lives beside `SLUG_RULE_VERSION`, and
`rex migrate-slugs --help` has a dedicated page saying it re-serialises at the
current rule and encodes no rule of its own — so it reads as the right tool for
a single drifted path as well as for a whole tree.
