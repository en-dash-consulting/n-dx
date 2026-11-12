---
"@n-dx/web": patch
---

Board-view Notion peek URLs now resolve to the page id.

The `p=` parameter takes precedence over the database id in the path, so the tracker move is no longer refused.
