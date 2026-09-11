---
"@n-dx/web": patch
---

Allowlist the config keys the adaptive routes may write.

`POST /api/hench/adaptive/override` and `/api/hench/adaptive/apply` read a
caller-supplied `key`/`configKey` and wrote it straight into `.hench/config.json`
via an unguarded `setNestedValue` — no allowlist, no value check, no protection
against a `__proto__` segment. A same-origin caller could set an invented key or
mistype a real one, and the next autonomous hench run would inherit it. This is
the sibling of the workflow-apply hole closed earlier.

The config-field allowlist (`CONFIG_FIELD_META`), its value validation, and the
nested get/set helpers now live in one shared module,
`hench-config-fields.ts`, imported by both `routes-hench.ts` (the config editor,
already allowlisted — the reference pattern) and `routes-adaptive.ts`, so the
three config-write paths cannot drift. Both adaptive routes now reject (400)
before writing when the key is not an allowlisted field, contains a
prototype-poisoning segment, or carries a wrong-typed value; `setConfigValue`
drops forbidden segments as defense in depth.

Found by the 2026-09-11 adversarial security review follow-up (task 0a778581).
