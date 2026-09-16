---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

Add `listWorktrees(cwd)` to `@n-dx/llm-client`: an async helper that parses `git worktree list --porcelain` into `{ path, branch, head, isMain, detached, bare }` entries with realpath-resolved paths, returning `[]` when git is missing or `cwd` is not a repository. Re-exported through hench's `llm-gateway`.
