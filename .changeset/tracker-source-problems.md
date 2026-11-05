---
"@n-dx/web": patch
---

A tracker sync rule that is on but cannot read its event source (GitHub reads off, or gh failing) now leaves a record that `GET /api/tracker/activity` answers as `sources`, and clears it when the source reads again.
