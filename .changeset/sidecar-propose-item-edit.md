---
"@n-dx/web": patch
---

The Sidecar can propose edits to an existing item. A new `propose_item_edit` card shows each changed field before and after, covering the title, description, done-when, tags and priority. The operator can change the proposed values, and only Approve writes them, through rex's `edit_item`. The Describe lens now uses this card for tightened done-when wording.
