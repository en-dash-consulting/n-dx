---
"@n-dx/sourcevision": patch
---

Stop git-backed sourcevision tests timing out on Windows CI

`branch-work-collector`, `pr-markdown`, and `pr-markdown-reviewer-output` build
real git repositories in a temp directory. The heaviest tests spend 8-13
synchronous `git` spawns each — init/config/commit/checkout in the fixture, plus
the collector's own `rev-parse` and two speculative `git show` calls. Those run
in 230-540ms locally, but Windows process creation and on-access scanning of the
temp worktree pushed three of them past vitest's 5000ms default.

Sourcevision was the last package with git-spawning integration tests still on
that default, so its `testTimeout` now matches hench and rex at 30s. No
production code changed.
