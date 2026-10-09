# PRD write concurrency

How n-dx keeps concurrent PRD writers from losing each other's work. The rules
an assistant has to follow are in `AGENTS.md` / `CLAUDE.md` under "Concurrency
contract"; this page is the reasoning behind them.

**What the code enforces:** the MCP write tools, the dashboard's PRD-writing routes (item CRUD, merge, prune, restore, and the SourceVision Ask panel's `apply-refinements`), and the bulk restructurers `reorganize`, `prune`, and `reshape` perform their read-modify-write inside `store.withTransaction`, which holds the PRD file lock across the whole span — a concurrent writer's item is no longer silently dropped by their full-document save. Their LLM analysis runs on an unlocked snapshot; accepted proposals are re-applied against a freshly loaded document under the lock. `saveDocument` itself always takes the lock, so writes cannot interleave, and a writer that cannot acquire the lock within its timeout fails loudly with an error naming the holder PID rather than proceeding.

**The PRD lock is per workspace, one per `rexDir`.** `prdLockPath(rexDir)` means each worktree's `.rex/` has its own lock, so two worktrees of the same repository write their own trees in parallel without contending — which is the point of worktree workspaces, and also why the lock is no help across them. The dashboard follows the same rule: every PRD-writing route resolves its store from the request's `ctx.rexDir`, so a request made under `/w/<key>/` (or with `X-Ndx-Workspace`) writes *that worktree's* `.rex/prd_tree/` and nothing else. There is no cross-workspace write anywhere in the dashboard — editing the anchor's PRD while viewing a branch means switching workspace through the breadcrumb switcher, which is a full navigation. The PRD view shows a one-line strip naming the workspace whenever it is not the anchor, so the write target is never inferred from the URL alone. MCP sessions follow the same rule: stdio rex/sv servers (and the `ndx mcp` hub bridge) bind to the worktree named by the client's MCP roots, so a desktop worktree session writes its own `.rex/prd_tree/` under its own lock, and a root that cannot be served refuses writes instead of falling back to the launch checkout.

**What remains operator discipline:** other CLI write paths (`analyze`/`plan` imports, `update`, `move`, `remove`, `fix`, and similar) still do their own load→mutate→save — the lock serializes their write but does not merge concurrent changes, so for those commands the last full-document writer still wins. Do not run them concurrently with other PRD writers, and prefer waiting for a background PRD-writing command to finish before making MCP writes: a restructure computed on a stale snapshot can turn individual proposals into no-ops (reported, not silent).

## See also

- [Architecture Overview](overview.md) — the tier hierarchy these entry points sit in
- [PRD folder-tree schema](prd-folder-tree-schema.md) — what the tree the lock guards looks like
