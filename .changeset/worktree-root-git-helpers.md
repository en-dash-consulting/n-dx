---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

Add `getWorktreeRoot(cwd)` and `getGitCommonDir(cwd)` to the llm-client exec
helpers, re-exported through hench's llm-gateway.

Both run `git rev-parse` synchronously, matching their `getCurrentHead` /
`getCurrentBranch` siblings, and return a realpath-resolved absolute path or
null outside a repository. `getWorktreeRoot` reports the containing worktree's
own root — a linked worktree's, not the main checkout's — and
`getGitCommonDir` reports the shared `.git`, which is identical across every
worktree of one repository. Together they let a caller tell "same repo,
different worktree" from "different repo", which is what binding a hench run's
automatic commits to the worktree it started in requires.
