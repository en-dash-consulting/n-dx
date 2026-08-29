---
"@n-dx/hench": patch
---

Close the hole in the `--review` commit-watcher suspension. Cancelling the watcher disarms a timer that has not fired, but it could not un-fire one that had: an auto-commit already inside `git commit` kept running while the reviewer spawned into the same working tree, so either the commit landed mid-review and moved HEAD with no warning (the HEAD-moved guard read HEAD before the commit finished), or the two git invocations collided on `.git/index.lock` and the commit failed after the message file had already been consumed — losing the executor's commit message with nothing committed.

The watcher now retains its in-flight auto-commit and exposes `settle()`, which the run awaits after cancelling and before spawning the reviewer. The wait is bounded by the commit's existing 30-second timeout, against a review pass measured in minutes.
