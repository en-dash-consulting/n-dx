---
"@n-dx/core": patch
---

Extension approval and disabled lookups now read only the keys `extensions.json` holds itself. Before this fix, once any extension was disabled, an extension named `constructor` was reported as disabled, and `ndx extensions enable constructor` printed "Enabled" without changing anything.
