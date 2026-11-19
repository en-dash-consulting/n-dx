---
"@n-dx/web": patch
---

Dashboard rows name an item by its short title, with the full title as the tooltip; the detail panel's Short title field sets or clears it.

The full title stays the detail panel's heading. Without a short title a row shows the plain-language summary, else the title, as before. The detail panel's Blocked By and children lists show the short title, else the title, never the summary. A short title an open item already shows is refused, and the edit now says why in an error toast rather than silently reverting. `PATCH /api/rex/items/bulk` refuses `shortTitle` with a 400: one name on several open items always collides, so it is edited per item.
