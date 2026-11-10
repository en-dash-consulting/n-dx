---
"@n-dx/rex": patch
"@n-dx/web": patch
---

Plain-language summaries are kept when the dashboard accepts analysis proposals, and the Plan capture bar drafts one in its Preview and saves it on Accept.

`rex add` on a v2 tree takes `--summary`, and its JSON preview drafts one per change with `--summarize`, using the light-tier model. A draft that fails is left out.
