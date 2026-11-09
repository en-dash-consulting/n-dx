---
"@n-dx/web": patch
---

The dashboard's run control finds the app's localhost link when the dev server colours it (Vite bolds the port), and offers it as an Open app button opposite Stop. Command output renders its terminal colours instead of showing `[0m` codes, and starts collapsed to its last three lines with a toggle for the full log.
