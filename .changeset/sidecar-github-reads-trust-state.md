---
"@n-dx/web": patch
---

Reading `web.sidecarGithubReads` from shared config checks the repository's trust with `isRepoRestricted`, the same decision the dashboard's trust gate makes. It no longer collects the PRD and run inventory on every branch-health or settings request.
