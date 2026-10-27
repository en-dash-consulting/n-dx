---
"@n-dx/core": patch
---

The extension discovery cache in `<ndx home>/extensions.json` now keeps entries for the 20 most recently scanned projects. Before this fix it gained an entry for every directory n-dx ran in and never dropped one.
