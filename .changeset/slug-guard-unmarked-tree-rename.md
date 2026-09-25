---
"@n-dx/rex": patch
---

The slug-rule write guard judges an unmarked tree by the paths already on disk, not by the slugs the pending save implies, so a write that renames an item (`rex update <id> --title="…"`) is never mistaken for a foreign build's re-slug. A genuinely foreign unmarked tree is still refused.

`rex migrate-slugs` is bounded to the direction it can actually migrate. It rewrites the tree under this build's rule, so on a tree marked with a *newer* rule it would perform a downgrade — and since the newer build would then refuse the tree and advise the same command, two builds could trade whole-tree renames by following their own instructions. `adoptSlugRule` refuses a newer marker, and the guard's refusals recommend upgrading rex rather than migrating when the tree is newer. A migration that only recorded the marker says so rather than reporting that nothing changed, and refusal sample lines use the platform path separator.
