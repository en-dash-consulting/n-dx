---
"@n-dx/rex": patch
---

`rex migrate-plan` reports commit evidence (N-DX-Item trailers and hench runs) on its own line and in `summary.commitEvidence`, instead of crediting it to the sourcevision analysis and hiding the `ndx analyze` hint. Commit evidence now covers only the items in the tree being planned, so an unrelated trailer commit no longer changes the evidence digest and resets the cut time. It drops lockfiles, manifests, changelogs, changesets and n-dx tool state, drops files most items' histories share, and keeps each item's 20 most-touched files, so a shared lockfile can no longer move a held change out of the Inbox.
