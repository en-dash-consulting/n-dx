---
"@n-dx/llm-client": patch
"@n-dx/web": patch
---

A repository's own `.n-dx.json` can no longer turn off the Sidecar's network-read cards. `web.sidecarGithubReads: true` in the shared config (or a committed `.n-dx.local.json`) applies only once the checkout is trusted (`ndx trust accept .`): until then `github_read` raises a card, and neither the Diagnose branch packet nor `GET /api/branch-health` runs gh. The key is a `network-reads` trust finding and is in the trust digest. The user's own `.n-dx.local.json` always applies, and the dashboard now saves the setting there.
