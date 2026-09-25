---
"@n-dx/rex": patch
---

The slug-rule write guard no longer refuses the writer's own rename. On a tree with no `slugRule` marker — which is every tree written before the guard shipped — the path scan compared the slugs the *pending* document implied against the paths on disk, so any write that changed a slug looked exactly like a foreign build's re-slug. `rex update <id> --title="…"` was refused on upgrade, and the refusal blamed another build for a mismatch the caller had just introduced. The scan now reads the tree from disk and judges it against itself; a genuinely foreign unmarked tree is still refused.

`rex migrate-slugs` is now bounded to the direction it can actually migrate. It rewrites the tree under this build's rule, so on a tree marked with a *newer* rule it performed a downgrade and reported a no-op — and since the newer build then refused the tree and advised the same command, two builds could trade whole-tree renames by following their own instructions. `adoptSlugRule` refuses a newer marker, the guard's refusals recommend upgrading rex rather than migrating when the tree is newer, and a run that recorded the marker no longer claims it changed nothing. Refusal sample lines also use the platform path separator.
