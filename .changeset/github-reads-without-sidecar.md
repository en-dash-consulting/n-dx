---
"@n-dx/web": patch
---

The GitHub reads switch on Settings › Project › Connections now appears when branch health is on, even with the Sidecar off.

Branch health reads `web.sidecarGithubReads` whether or not the Sidecar runs, but the switch used to show, and save, only through the Sidecar's own routes. Those refuse while the Sidecar is off. `GET /api/project-settings` now reports `githubReads`, the value in force, and `PUT /api/project-settings` accepts it. It is saved to your local config exactly as the Sidecar route saves it. A save that changes only GitHub reads no longer rewrites `.n-dx.json`.
