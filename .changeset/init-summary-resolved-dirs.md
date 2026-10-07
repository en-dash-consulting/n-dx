---
"@n-dx/core": patch
---

`ndx init` now names the directories it actually created. The static summary
printed `.sourcevision/`, `.rex/` and `.hench/` unconditionally while
`establishInitLayout` had already put every new project on the `.ndx/` layout,
so a fresh init reported three directories that were not there — the
created/reused verdict was right, only the labels were hard-coded. Both recaps
(Ink and static) now read their labels from the resolved layout through one
shared helper, and `ndx init --help` no longer claims a fixed folder.
