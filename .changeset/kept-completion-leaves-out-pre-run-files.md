---
"@n-dx/hench": patch
---

A kept v2 completion's run error no longer puts files that were already dirty before the run into its `git add` / `git commit` commands. It lists them apart, as dirty before the run and not part of the task.
