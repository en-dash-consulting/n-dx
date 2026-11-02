---
"@n-dx/llm-client": patch
"@n-dx/web": patch
---

Reading `web.sidecarGithubReads` from shared config checks only the repository's trust state (`repoTrustStateOf`). It no longer walks the whole PRD tree on every branch-health or settings request.
