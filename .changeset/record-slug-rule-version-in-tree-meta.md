---
"@n-dx/rex": patch
---

The PRD tree now records which slug rule wrote it, and a build that implements a different rule refuses to write it.

`tree-meta.json` gains a `slugRule` integer beside `title` and `schema`, sourced from a single `SLUG_RULE_VERSION` constant declared next to the slug functions. Every save checks the marker before writing a single file: a different version refuses the whole save, naming both versions and `rex migrate-slugs`; an absent marker is adopted only if the tree's paths already conform, and refused otherwise. `rex validate` reports a marker mismatch as an error, which catches a tree written by a *future* rule — one whose paths this build cannot derive and so cannot inspect.

`rex migrate-slugs` is the one command that may re-slug a tree, and it sets the marker in the same locked write. Older builds ignore the unknown key, so a marked tree still loads everywhere.
