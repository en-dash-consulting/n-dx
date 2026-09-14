---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

Add `listWorktrees(cwd)` to the foundation exec helpers (0.6.0 / PR 5, worktree awareness).

Async enumeration of a repository's checkouts via `git worktree list --porcelain`: `Array<{ path, branch, head, isMain, detached, bare }>` with realpath-resolved paths, `[]` when git is missing or `cwd` is not a repository, a 5s ceiling, and stderr captured rather than inherited. The sourcevision analyzer's synchronous copy in workspace.ts is deliberately untouched. Re-exported through hench's llm-gateway (export cap 164 → 166 with justification); web imports the foundation barrel directly, as its tier rules allow.
