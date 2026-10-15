---
"@n-dx/web": patch
---

The git panel can commit a tree of generated files in one click, and optionally without being asked.

`GET /api/git/status` now reports where each dirty file came from — the PRD tree, SourceVision scan output, or the user's own work — classified from the project's own layout rather than hardcoded `.rex` / `.sourcevision` spellings, so a v2 project under `.ndx/` classifies correctly. When every dirty file shares one origin the response says so, and the panel offers a labelled one-click commit with a constant message.

`POST /api/git/commit` takes an optional `scope`. A scoped commit re-reads `git status` server-side and derives the paths itself rather than trusting anything from the caller, refuses with 409 if the tree is no longer homogeneous (naming the unexpected files), and stages and commits by pathspec. Without a scope the route behaves exactly as before. This matters because the existing path runs `git add -A`, which cannot express "only the PRD files".

A new `git.autoCommitGenerated` toggle, off by default, does the same thing unattended via the `useAutoCommitGenerated` hook. The server re-checks the toggle on every automatic request and refuses with 403 when it is off, so a stale client cannot commit on its own. Nothing is ever pushed, and a tree containing any of the user's own work is never touched.

This is the plumbing the "fail-forward mode" feature builds on.
