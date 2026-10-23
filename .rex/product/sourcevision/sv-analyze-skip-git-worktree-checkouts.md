---
id: "36cd4378-93d4-4cf7-8381-7029a98ef2f2"
type: "capability"
title: "sv analyze: skip git worktree checkouts in sub-analysis discovery"
slug: "sv-analyze-skip-git-worktree-checkouts"
statement: "When sv analyze discovers nested sub-analyses, it skips the .claude directory and any git worktree registered under the analysis root, while still promoting the .sourcevision directories in ordinary subdirectories."
criteria: [{"id":"c1","text":"When sv analyze searches the project tree for nested .sourcevision directories, sourcevision shall not descend into the .claude directory."},{"id":"c2","text":"When sv analyze searches for nested sub-analyses, sourcevision shall skip every directory that git reports as a registered worktree located strictly inside the analysis root."},{"id":"c3","text":"Sourcevision shall resolve the set of registered git worktrees once per sub-analysis scan, by running git worktree list from the analysis root."},{"id":"c4","text":"When sourcevision compares a directory with a registered worktree path, it shall compare resolved real absolute paths, so that symlinks and trailing separators do not cause a worktree to be missed."},{"id":"c5","text":"When the analysis root is itself a git worktree, sourcevision shall analyze that root normally and still promote its own sub-analyses."},{"id":"c6","text":"When a .sourcevision directory is in an ordinary subdirectory such as packages/rex/.sourcevision/, sourcevision shall detect it and promote it into the parent analysis."},{"id":"c7","text":"If git is unavailable, the root is not a git repository, or the worktree query fails or times out, sourcevision shall continue the sub-analysis scan with an empty worktree set, without throwing an error or writing to stderr."}]
priority: "critical"
---

BUG (hotfix). `sv analyze` promotes git worktree checkouts as sub-analyses, flooding the parent analysis with duplicate zones.

Symptom: a recent `sv analyze` on this repo returned 120 zones, 87 of which were worktree duplicates. Each live worktree under `.claude/worktrees/<name>/` is a full checkout that contains the tracked `.sourcevision/` directory, so each one injects roughly 29 duplicate zones. New worktrees appear continuously because hench spawns sessions that create them, so manual `git worktree remove` is a treadmill.

Root cause: `findSubSvDirs()` in `packages/sourcevision/src/analyzers/workspace.ts` recursively walks the project tree looking for nested `.sourcevision/` directories and promotes every hit into the parent analysis with prefixed zone IDs. Its local `SKIP_DIRS` set does not include `.claude`, and unlike the inventory analyzer it does not consult `.gitignore` (where `.claude/worktrees/` and `.ndx-deploy-tmp` are already listed) or git's own worktree registry.

Required change (both parts, in `packages/sourcevision/src/analyzers/workspace.ts`):
1. Add `.claude` to the `SKIP_DIRS` set in `findSubSvDirs()`. This is the immediate fix for the observed noise.
2. Also skip any directory that git reports as a registered worktree under the analysis root. Resolve the set once per scan (not per directory) via `git worktree list --porcelain` run with `cwd` = the analysis root; parse the `worktree ` lines; keep only paths that resolve to a real path strictly inside the root; and never skip the root itself (running `sv analyze` from inside a worktree must still analyze that worktree normally). This covers in-repo worktrees outside `.claude/`, such as the `.ndx-deploy-tmp` worktree that `packages/core/export.js` creates.

Constraints:
- Best-effort and non-fatal: if git is unavailable, the directory is not a repo, or the command fails or times out, the scan must proceed exactly as before with an empty worktree set. No thrown errors, no stderr spew.
- Compare paths with real/resolved absolute paths so symlinked checkouts and trailing-separator differences do not cause misses.
- Do not change the inventory, imports, or zone analyzers. Do not change any other SKIP_DIRS set in the codebase.
- Keep the change small and reviewable; this is a hotfix targeting a fast merge.

Acceptance criteria:
- `findSubSvDirs()` does not descend into `.claude/` and does not return any directory that is a registered git worktree nested under the analysis root.
- A `.sourcevision/` directory in a normal subdirectory (for example `packages/rex/.sourcevision/`) is still detected and promoted exactly as before.
- Analyzing a project whose root is itself a git worktree still works and still promotes that project's own legitimate sub-analyses.
- Unit tests added to `packages/sourcevision/tests/unit/analyzers/workspace.test.ts` cover: `.claude` skipped, a nested registered worktree skipped, a normal sub-analysis still detected, and the git-unavailable fallback path.
- `pnpm --filter @n-dx/sourcevision test` (or the repo's equivalent) passes; existing workspace tests are unchanged in intent.
- A `patch` changeset is added for `@n-dx/sourcevision`.
