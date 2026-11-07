---
"@n-dx/rex": patch
"@n-dx/hench": patch
---

rex's `findNextWorkTask` takes an optional `workspace`: given one, it narrows selection to that checkout's branch work set (unless `any`) and returns `{ task, workSet }`. Callers that pass no workspace see no change. hench now reads the work set from it and no longer imports `currentWorkSet`, which rex still exports.
