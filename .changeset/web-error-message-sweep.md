---
"@n-dx/web": patch
---

Every dashboard route now answers a failure with the error's message alone. Routes that stringified the caught value (`String(err)`, which reads "Error: <message>") or hand-rolled an `instanceof Error` ternary with a stringified fallback go through the one `errorMessage()` helper, as the smart-add accept route already did, and the served status fields (sv-analyze, self-heal, init, refresh, the generic command jobs, epic-by-epic execution, hench task execution and run reconcile) carry the same message. A thrown non-Error is logged on the server and answered with a fixed line instead of its string form. A test under `packages/web/tests/integration/` fails any `errorResponse`/`jsonResponse` argument that stringifies the caught value, and any file under `src/server/` that writes the ternary again.
