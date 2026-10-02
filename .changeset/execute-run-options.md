---
"@n-dx/web": patch
---

`POST /api/hench/execute` accepts `options` for one run: `model`, `provider`, `permissionMode`, `review`, `reviewModel`, `skipTestGate`, `maxTurns`, `tokenBudget`, `fresh`, `allowDirty` and `contextNotes`, each translated to its `ndx work` flag through an allow-list in `src/shared/run-options.ts`. The model must be in the active vendor's catalog and the provider one the vendor supports. `contextNotes` is written to a temp file, passed as `--context-file` and removed when the run ends. An unknown key or invalid value answers 400 naming the key, and the 202 echoes the accepted options. A run the hub queues keeps its options and replays them when admitted. Asking again for a queued task keeps its place and uses the newer options. Blocked tasks now answer 409 naming their blockers. An in-progress task can be started when no live run in any worktree and no claim holds it.
