---
"@n-dx/web": patch
---

Dashboard rows on Plan and Work lead with an item's plain-language summary and show impact tags for size, security-sensitive files, essential files and file kinds.

The technical title stays as the row's tooltip and the detail panel's heading, and the detail panel gains an editable "In plain terms" field. Tags come from the files runs changed or, before any run, the files the item names. `GET /api/rex/impact` serves them, and the detail panel lists the files behind each tag.
