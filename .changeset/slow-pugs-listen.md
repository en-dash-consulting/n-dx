---
"@n-dx/hench": patch
"@n-dx/web": patch
"@n-dx/core": patch
---

List every hench setting on the Workflow page and in `hench config`

`ndx config`, `hench config` and the dashboard's Workflow page each kept their own
hand-written list of hench settings, and the three had drifted. `hench config` was
missing sixteen documented keys — `promptCacheTtl`, the whole `prune` and test-gate
groups, the git-safety pair, session reuse — and the Workflow page was missing those
plus the guard keys the CLI already had. One of them, `guard.memoryMonitor.spawnThreshold`,
is named in the message hench prints when it throttles a spawn, so the suggested
`hench config` command answered "Unknown config key".

All three surfaces now offer every key hench's schema defines, grouped into Session
Reuse, Context Prune, Test Gate and Git Safety alongside the existing categories.
`tests/e2e/hench-config-gate-contract.test.js` compares the lists and pins each
recorded default against hench's own, so they cannot drift apart again.

Also fixed:

- The dashboard can now edit `prune.*`. Its write gate was per-field and could not see
  that hench refuses a config whose `prune.retainPairs` reaches its `prune.triggerPairs`;
  a new sibling-constraint check runs on the finished config, after group completion, on
  every write path.
- The gate understands `min`/`max` bounds, so it no longer accepts a memory threshold
  above 100 that hench would then refuse.
- `language: "swift"` was rejected by hench's own config schema even though `hench init`
  writes it for a Swift project.
- The Workflow page appends any category it does not recognise instead of dropping it,
  and `hench config --interactive` no longer offers "1-5" when there are nine categories.
