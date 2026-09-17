---
"@n-dx/hench": patch
---

`hench run --dry-run` no longer takes a cross-worktree task claim.

The claim is taken in `assembleTaskBrief`, which runs before the dry-run
branch in both the CLI and API loops, so a preview wrote a real claim for a
run that does no work. It was released in `runOne`'s `finally`, so nothing
leaked, but while the preview was open a dry run in one worktree could refuse
a genuine run starting in another, and every preview took the claims lock to
write a record it would immediately discard.

`TaskClaims` now has a read-only mode, set from the dry-run flag. In that mode
claiming answers the question the caller is really asking — would a real run
be refused here? — by reading the store, and records nothing. A dry run is
still told when a task is held elsewhere, which is faithful to what a real run
would meet, and autoselect still passes over tasks other worktrees hold,
because that path only ever reads.
