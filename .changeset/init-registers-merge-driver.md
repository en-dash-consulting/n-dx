---
"@n-dx/core": patch
---

`ndx init` now registers the rex-prd merge driver.

Alongside the existing `.gitattributes` EOL pins, init appends `.rex/prd_tree/** merge=rex-prd` (same idempotent pattern-keyed mechanism — a user's own line for the pattern wins) and, inside a git repository, registers `merge.rex-prd.name` and `merge.rex-prd.driver` (`rex merge-driver %O %A %B`) in git config. An already-set driver — including a user-customized command — is left untouched, re-running init changes nothing, and outside a git repo the registration is silently skipped: init never fails over it. Together with the `rex merge-driver` command this makes PRD tree merges three-way and frontmatter-aware out of the box.
