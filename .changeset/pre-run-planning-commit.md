---
"@n-dx/hench": patch
---

Before a run, n-dx commits its own pending planning files — the PRD folders and the project config, in either layout — as a commit of their own (`chore(prd): commit planning changes before run`, with the `--task` item's `N-DX-Item` trailer), then starts. Any other uncommitted file still refuses, and the refusal now lists only those files. `--resolve` reports the files it would commit as `workspace.planningCommit` and a `planning-commit` warning, which the dashboard and Sidecar show before a start. `--allow-dirty` still leaves the tree alone.
