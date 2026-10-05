---
"@n-dx/web": patch
---

`GET /api/hench/ready` reads `limit` as a whole number: `1e9` returns the maximum of 50 rows instead of one, and `10abc`, `2.5` or an empty value use the default of 10. Zero and negative values still clamp to 1.
