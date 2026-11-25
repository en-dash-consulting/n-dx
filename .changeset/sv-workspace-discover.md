---
"@n-dx/sourcevision": patch
---

`sv workspace --discover <dir>` finds the repositories under a folder, analyses each with `analyze --fast`, and aggregates them into one workspace.

A repository root is a folder with `.git` (directory or file) or `.svn`. The walk never descends into a found repository and never follows a symlink; a symlink to a repository outside the folder is reported. A repository that already has an analysis of its current HEAD is not analysed again. Analyses run in child processes with no model or network call and credentials stripped from their environment, `--jobs=<n>` at a time (default 2), each stopped after `--timeout=<s>` seconds (default 600). Repositories that fail, time out or have no supported files are listed with the reason and left out; `--json` prints the found and skipped lists. The folder becomes the workspace root, so a folder that is itself a repository is refused.
