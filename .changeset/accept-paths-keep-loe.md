---
"@n-dx/rex": patch
"@n-dx/web": patch
---

`rex add` (smart add) and the dashboard's proposal accept routes now keep `loe`, `loeRationale` and `loeConfidence` on the tasks they create; invalid values are dropped. `rex add` no longer strips the fields while attaching duplicate reasons.
