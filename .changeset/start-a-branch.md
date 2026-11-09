---
"@n-dx/web": patch
---

Work and Changes gain "Start a branch": pick open changes, name the branch (prefilled `feat/<slug>` from the first change), and cut it from the default branch or stack it on the current work-set branch. On a clean checkout with no live run the dashboard switches to the branch, assigns the changes and commits the PRD with one `N-DX-Item` trailer per change; a failure undoes the branch. Otherwise it creates the branch only and shows the `git switch` command. `POST /api/rex/branch/start` refuses a taken name with 409 `NAME_TAKEN`.
