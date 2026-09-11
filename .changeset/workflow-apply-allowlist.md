---
"@n-dx/web": patch
---

Allowlist the config keys `POST /api/hench/workflow/apply` may write.

The endpoint applies machine-generated workflow suggestions, but
`handleApplySuggestion` wrote whatever keys the request named into
`.hench/config.json` with no allowlist and no value check. A same-origin caller
could set `guard.allowedCommands`, `guard.blockedPaths: []`, or
`permissionMode: "bypassPermissions"` — and the next hench run would inherit
them (arbitrary commands, no path sandbox, permissions bypassed) — or use a
`__proto__` path segment to poison the prototype chain.

`apply` now validates `changes` against `APPLYABLE_SUGGESTION_KEYS` — the exact
set the suggestion generator emits (`tokenBudget`, `maxTurns`,
`retry.maxRetries`), each required to be a nonnegative integer — before preview
or any write, so a rejected request (400) leaves the config file untouched. Path
segments `__proto__`/`constructor`/`prototype` are refused, and the module's
`setNestedValue` drops them as defense in depth. A test pins the allowlist to
the keys the generator actually emits so the two cannot drift.

Found by the 2026-09-11 adversarial security review (finding F).
