---
"@n-dx/rex": patch
---

Report PRD tree paths written in a foreign slug convention, and pin write-path
parity.

A rex build older than the id-qualified slug rule (landed 2026-08-26)
re-serializes the whole tree to the suffix-less form on its first write —
observed 2026-09-01 as 823 of 1398 files renamed by a single status update.
Nothing caught it: every rename was lossless, item content was untouched, and
`rex validate` inspects item fields without ever looking at the paths those
items live in. So an 800-file rewrite read as a clean tree.

`findNonConformingSlugs` compares each item's on-disk entry against what
`slugify` would produce, and `rex validate` reports mismatches as warnings
naming `rex migrate-slugs` as the repair. An item whose file is merely missing
is not reported — that is a separate fault, and folding it in would make this
finding noisy enough to ignore.

Also adds `write-path-parity.test.ts`, which disproves the assumption that
prompted this work: the MCP handler and the CLI's update sequence produce
byte-identical trees, and a status update rewrites at most three files at
steady state. The suspected divergence was not in either code path.
