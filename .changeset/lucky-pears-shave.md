---
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
---

Route rex and sourcevision file access through their paths modules

Every site that composed its own `.rex/` or `.sourcevision/` path now asks the
layout resolver instead, so both packages follow whichever folder layout a
project is on rather than assuming the legacy one. `REX_DIR` and `SV_DIR` are
gone — a bare directory name is the thing that made the layout a decision taken
at ~120 call sites.

Behaviour on a legacy project is unchanged. Three user-visible details moved
from a fixed string to the resolved location: the legacy-PRD migration banner
now names the folder tree the migration actually wrote (reported by
`ensureLegacyPrdMigrated` as `folderTreePath`), `rex export`'s refusal message
names the PRD directory the project actually uses, and `sv analyze`'s background
narration log path follows the analysis directory.

`packages/sourcevision/src/export/` bundles into the dependency-free standalone
iso-map skill and so cannot import the resolver; it carries a hand-written twin,
`analysisDirFor`, pinned to the canonical implementation by
`tests/integration/layout-resolver-contract.test.js`.
