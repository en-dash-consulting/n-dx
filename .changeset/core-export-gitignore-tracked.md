---
"@n-dx/core": patch
---

`ndx export` no longer adds a git-tracked out-dir to `.gitignore`, and says what it decided either way. Exporting into a directory you commit on purpose — `--out-dir=docs/site` feeding your own Pages pipeline — used to append `docs/site/` to `.gitignore` with no output at all: the tracked files stayed tracked, but everything written there afterwards became invisible to `git status` and nothing said why. A tracked directory is now left alone with a notice, and an entry that is added is announced. `isGitTracked` moved to `gitignore.js`, beside the writer whose decision it governs.
