---
"@n-dx/web": patch
---

Stop the dashboard's hench-config gate accepting values hench's schema rejects.

`validateFieldValue` (`hench-config-fields.ts`) is the single gate for the three
routes that write `.hench/config.json` — `PUT /api/hench/config`,
`POST /api/hench/adaptive/apply`, and `POST /api/hench/adaptive/override` — but
it was looser than hench's `HenchConfigSchema` in three ways. Enum fields were
checked via `String(value)`, so `provider: ["cli"]` coerced to `"cli"` and an
array was written where `z.enum` expects a string. Array fields were checked with
`Array.isArray` alone, so `guard.allowedCommands: [1, null]` passed a
`z.array(z.string())` field. Number fields rejected only negatives and `NaN`, so
`0` was written to `guard.commandTimeout` (`z.number().positive()`) and JSON
`1e999` was accepted as `Infinity`, which `JSON.stringify` then wrote as `null`.
Each case returned 200 and produced a config hench refuses to load, so the next
`ndx work` would not start until the file was hand-edited.

The gate now requires a string before an enum lookup, requires every array
element to be a string, requires `Number.isFinite`, and honours two new
`ConfigFieldInfo` flags — `positive` and `integer` — that mirror the `.positive()`
and `.int()` refinements on the matching hench field. A new cross-package
contract test (`tests/e2e/hench-config-gate-contract.test.js`) probes every
writable field against both definitions and fails if the gate ever accepts
something `HenchConfigSchema` rejects, so the two cannot drift again silently.

Found by the 2026-09-15 adversarial review (task 0a85aec1).
