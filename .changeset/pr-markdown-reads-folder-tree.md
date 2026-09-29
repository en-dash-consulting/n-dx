---
"@n-dx/sourcevision": patch
"@n-dx/rex": patch
---

Point SourceVision's pull-request markdown at the folder tree through rex, fixing an empty Completed Work section.

The branch-work collector read `.rex/prd.md`, which no longer exists once a project has migrated to `.rex/prd_tree/`. On every folder-tree project the Completed Work section therefore found nothing and said so, with no error to explain it. It now asks rex two questions instead — `rex tree --format=json` for the PRD and `rex tree-diff --json` for what this branch completed — so no code path reads `prd.md` or `prd.json` for PR markdown.

The collector's own copy of the completion diff is gone with it. "What did this branch finish" is rex's question, and it was previously answered by three implementations (the CLI, the dashboard's PRD delta, and this one) that were free to drift apart.

`rex tree --format=json` is new: the machine-readable rendering of the same hierarchy `rex tree` prints, filtered identically. It is the folder-tree replacement for the `rex parse-md --stdin` seam that let a consumer outside rex read the PRD without a second parser.
