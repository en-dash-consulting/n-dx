---
"@n-dx/hench": patch
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/web": patch
---

Test-only: fixture git repositories take their identity, line-ending and signing config from one gitconfig that the shared vitest setup writes and points `GIT_CONFIG_GLOBAL` at, instead of two to five `git config` spawns per repository. hench's `initGitFixtureRepo` is now a bare `git init`. No production code changed.
