---
"@n-dx/rex": patch
---

New `rex merge-driver` command: a three-way, frontmatter-aware git merge driver for `.rex/prd_tree/`.

Git's default text merge produces spurious conflicts on PRD markdown (two branches touching adjacent frontmatter lines) and silent mis-merges of list fields. The driver merges at field granularity with a rule per field class: `tags`/`blockedBy` get a three-way set merge (additions from both sides land, removals stick — never conflicts); `status`/`priority` divergence resolves to the side with the later `lastModified` stamp; `lastModified` takes the later value; every other field and the body merge plain three-way. Only genuinely conflicting fields emit standard `<<<<<<<`/`>>>>>>>` markers — everything mergeable still merges around them — and the driver exits nonzero so git marks the path conflicted, per the merge-driver protocol (result written to the %A path).

Register per repository (a future `ndx init` change will do this automatically):

```
git config merge.rex-prd.name   "n-dx PRD tree merge"
git config merge.rex-prd.driver "rex merge-driver %O %A %B"
echo '.rex/prd_tree/** merge=rex-prd' >> .gitattributes
```
