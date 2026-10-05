---
"@n-dx/web": patch
---

Bound `tokenBudget` at `Number.MAX_SAFE_INTEGER` and require every integer run option to serialize as plain decimal digits. `{"options":{"tokenBudget":1e21}}` used to become `--token-budget=1e+21`, which hench's `parseInt` read as 1, so the run hit its budget at once while the 202 echoed 1e21. It now answers 400 naming `tokenBudget`, and the Prepare task modal's number input carries the same `max`.
