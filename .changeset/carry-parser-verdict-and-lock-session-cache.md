---
"@n-dx/llm-client": patch
"@n-dx/hench": patch
---

Carry the token parser's verdict on the runtime event, and serialize session-cache writes.

`RuntimeEvent` now carries `tokenDiagnosticStatus` and `tokenCacheProvenance`. Both were computed by `parseTokenUsageWithDiagnostic` and then discarded when the event was built, so the event pipeline re-derived them from the parsed numbers. That inference cannot match the parser: the parser decides from field presence, while the numbers only show values. An explicit `input_tokens: 0` is a complete measurement that inferred as `partial`, and a zero-valued cache count is omitted from `TokenUsage` entirely, so it inferred as `unavailable` where the parser said `measured` — a parity gap between legacy and event-pipeline run records. Consumers prefer the carried values and keep the inference as a fallback for events produced before the fields existed.

Session-cache mutations now hold an exclusive lock for the whole read-modify-write, and write through a temp file and a rename. `maxConcurrentProcesses` defaults to 3, so concurrent runs in one checkout are normal: two tasks advancing the same batch chain each persisted their own `tasksUsed` and session id over the other's, and `clearSessionCache` could delete a chain written between its own read and its `rm`, breaking the preservation contract it documents. The lock is best-effort by design — a cache is an optimisation, so it proceeds unlocked after a timeout rather than failing a run, and steals a lock left behind by a killed process.
