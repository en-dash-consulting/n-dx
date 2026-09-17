---
"@n-dx/hench": patch
---

Run records no longer lose fields on load. `RunRecordSchema` did not declare `testGate`, `dependencyAudit`, `cleanupTransformations`, `vendor`, `weight`, `parentSessionId`, `contextCondensations` or `invocationContext`, and zod strips what a schema does not declare — so `saveRun` wrote all eight to disk and every `loadRun` and `listRuns` returned them as undefined, silently. Each is now declared, optional and permissive enough that a record written before it existed still parses (a rejected record is swallowed by `listRuns`, which would lose the whole run rather than one field). A new drift test fails if a field is added to the `RunRecord` type without a matching schema entry.
