---
"@n-dx/rex": patch
---

Rex exports `currentWorkSetBranch(projectDir)`, which returns the workspace's checked-out branch and null on the default branch, a detached HEAD or outside a git repository. It reads the default branch the way `isDefaultBranch` does.
