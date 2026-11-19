---
"@n-dx/web": patch
---

Dashboard rows name an item by its short title, with the full title as the tooltip; the detail panel's Short title field sets or clears it.

The full title stays the detail panel's heading. Without a short title a row shows the plain-language summary, else the title, as before. A short title an open item already shows is refused, and the edit now says why in an error toast rather than silently reverting.
