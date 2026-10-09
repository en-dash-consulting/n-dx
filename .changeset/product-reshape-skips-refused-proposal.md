---
"@n-dx/rex": patch
---

`rex reshape --accept` on a v2 tree no longer fails when one product-layer proposal would make the drafted change unappliable, such as a move under an area that another proposal removes. That proposal is reported as not drafted, with apply's reason. The other proposals are still drafted, and the change-layer pass still runs.
