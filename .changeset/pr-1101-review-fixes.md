---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
"@n-dx/web": patch
"@n-dx/core": patch
---

Saving the agent prompt no longer follows a broken symbolic link out of the project, and the run queue keeps blocked work and no longer loses concurrent changes.

A prompt path that is a dangling link is judged by where it points, so a link to a missing file outside the project is refused instead of creating it. A queued task whose status is blocked or deferred keeps its place; only finished, cancelled or deleted work leaves the queue. `ndx work` and the dashboard take one lock, `run-queue.json.lock`, around every queue change, so neither overwrites the other; add `.hench/run-queue.json.lock` to your `.gitignore`, as the `ndx init` template now does. In Work › Now, a task running in another worktree opens in that worktree, where its log and Stop are.
