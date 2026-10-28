---
"@n-dx/web": patch
---

The Work page's Up Next card no longer shows an empty badge where the item's type goes. It reads the type from the node the dashboard sends (`type` on v2, `level` on v1), and shows a placed change's display id beside it; an Inbox change shows its type and no blank slot.
