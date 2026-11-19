---
"@n-dx/web": patch
---

The dashboard Inbox gains **Place best guesses**, which reviews every change's best placement guess with a checkbox and places the ticked ones as Touches in one write.

Weak guesses start unticked, and applied changes that were never placed are included and marked *applied*. A pair rex refuses is listed and the rest are written. Each Inbox row with a guess also has **Accept**, which places that one change on its guess. Both write through the new `POST /api/rex/changes/place-best`, which records only `touches` placements: amending a spec is never done in bulk.
