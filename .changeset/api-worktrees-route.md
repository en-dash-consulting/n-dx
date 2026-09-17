---
"@n-dx/web": patch
---

Add `GET /api/worktrees`: every git worktree of the served repository with branch, HEAD, anchor/served flags, dirty state, a summary of the hench runs recorded under it, and whether an `ndx start` server is present (pid/port marker files). Best-effort per worktree, cached for 5 s, `[]` outside a repository.

Retire the half-built sibling-directory project scan (`GET /api/projects`, `detectProjects`): nothing in the viewer consumed it, and cross-project switching is the 0.7.0 hub registry's job.
