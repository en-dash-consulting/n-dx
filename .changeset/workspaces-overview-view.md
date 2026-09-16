---
"@n-dx/web": minor
---

Add the Workspaces Overview view: a new WORKSPACES sidebar section (above SOURCEVISION, one item "Overview") opening a board of one card per git worktree of the served repository, under a machine strip of four stat tiles — agents running, memory in use, uncommitted trees, and PRD items that exist only on branches.

Each card carries the worktree's branch, its live hench run (task title linking into *that* worktree's PRD, elapsed time, tok/s and last output line) or when it last ran, an uncommitted-files or clean chip, a PRD-delta chip versus the anchor, and the actions Open workspace, Start working and Stop. The board addresses each worktree with the `X-Ndx-Workspace` header, and — uniquely among socket consumers — keeps frames about other workspaces rather than filtering them out, so a run progressing in one worktree moves its card while you are looking at another.

`StartTaskButton` gains optional `workspace` and `ariaLabel` props; with `workspace` set the run starts in that worktree (cwd = worktree). Sidebar sections that end up with no visible items are no longer rendered as an empty header.
