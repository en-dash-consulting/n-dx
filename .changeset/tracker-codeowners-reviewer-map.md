---
"@n-dx/web": patch
---

Tracker sync sends a CODEOWNERS owner as the tracker user id mapped in `trackerSync.reviewers`, never the raw GitHub handle; an unmapped handle becomes a card naming it.
