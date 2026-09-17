---
"@n-dx/hench": patch
---

A run that ends without committing no longer leaves its proposed commit message where the next run will use it. The agent writes `.hench-commit-msg.txt` after staging, and the commit prompt returns early on a non-completed run, so a test-gate failure, an uncommitted-work refusal or a missing-review refusal left the file on disk. The next run's watcher arms on finding that file rather than on writing it, and after the commit-message timeout committed the new task's staged work under the previous task's message and `N-DX-Status` trailer — naming the wrong item in the audit trail. `finalizeRun` now moves the message to `.hench/runs/<run-id>.commit-msg.txt`, a location already gitignored and already discounted by the pre-run gate, so nothing is destroyed and nothing is left to arm the next watcher.
