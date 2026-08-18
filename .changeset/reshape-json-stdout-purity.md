---
"@n-dx/web": patch
"@n-dx/rex": patch
---

Fix the dashboard Reshape preview always reporting "no proposals": the server now spawns `rex reshape --format=json --quiet` so stdout is pure JSON (info() progress prose no longer breaks the report parse), and `rex reshape --format=json` emits a JSON report (`proposals: []`) instead of prose when no proposals are found.
