---
"@n-dx/web": patch
---

Overview Next Steps panel now matches the page's section styling (its classes previously had no CSS), adds per-item copy and copy-all-as-markdown controls, and gains a confirm-guarded "Capture to PRD" action backed by a new `POST /api/rex/capture-next-steps` endpoint that dedups findings by normalized title and files them as features under a "SourceVision Next Steps" epic.
