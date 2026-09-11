---
id: "0a778581-d674-429c-827a-6b0e1ef22e0f"
level: "task"
title: "`/api/hench/adaptive/override` and `/apply` write arbitrary keys into `.hench/config.json`"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "security"
  - "severity:medium"
  - "web"
source: "ndx-work"
acceptanceCriteria:
  - "`POST /api/hench/adaptive/override` with a key outside the adjustable-config allowlist returns 400 and `.hench/config.json` is unchanged"
  - "`POST /api/hench/adaptive/apply` with an un-allowlisted `configKey` returns 400 and the config is unchanged"
  - "Either route with a `__proto__`/`constructor`/`prototype` segment returns 400 and does not pollute Object.prototype"
  - "A wrong-typed value for an allowlisted key returns 400"
  - "The allowlist is shared with (or asserted equal to) `routes-hench.ts`'s `CONFIG_FIELD_META` so the three config-write paths cannot drift"
  - "Unit tests for the rejection cases plus one accepted override on each route"
description: "**Severity:** medium · **Verdict:** should-fix (defense-in-depth) · **Sibling of finding F (d8d1d03d).**\n\nDiscovered while fixing d8d1d03d: two more dashboard routes have the same unguarded-config-write shape that F just closed for `/api/hench/workflow/apply`.\n\n**Failure scenario.** `POST /api/hench/adaptive/override` with `{\"key\": \"guard.allowedCommands\", \"value\": [\"sh\",\"curl\"]}` (or `{\"key\":\"permissionMode\",\"value\":\"bypassPermissions\"}`, or a `__proto__` segment) rewrites `.hench/config.json` — `handleSetOverride` (`routes-adaptive.ts:813`) reads `body.key`/`body.value`, checks only that both are present, then `setNestedValue(config, key, value)` and writes the file. No key allowlist, no value validation. `POST /api/hench/adaptive/apply` (`handleApplyAdjustment`, `routes-adaptive.ts:697`) is identical with `body.configKey`/`body.newValue`. `routes-adaptive.ts`'s own `setNestedValue` (`:481`) does not guard `__proto__`/`constructor`/`prototype` either. The next autonomous hench run then inherits whatever was written.\n\n**Not affected:** `routes-hench.ts`'s config PUT (`:694`) already allowlists via `CONFIG_FIELD_META` + `validateFieldValue`; leave it as the reference pattern.\n\n**Reachability.** Same-origin only (the Origin/Sec-Fetch-Site guard blocks cross-site POSTs and no XSS primary is known) — same posture as F. Reported as defense-in-depth.\n\n**Evidence.** `packages/web/src/server/routes-adaptive.ts:813-846` (override), `:697-740` (apply, `configKey`), `:481` (unguarded `setNestedValue`). Compare the fix in `routes-workflow.ts` (`APPLYABLE_SUGGESTION_KEYS` + `validateSuggestionChanges`, finding F, commit 76aefb11).\n\n**Solution options.**\n1. *(Recommended)* Reuse the pattern F established: an allowlist of the config keys the adaptive engine legitimately adjusts (derive it from `CONFIG_FIELD_META`, which `routes-hench.ts` already uses, so all three write paths share one source of truth), reject anything else and any `__proto__`/`constructor`/`prototype` segment with 400 before writing, and validate value types. Harden `routes-adaptive.ts`'s `setNestedValue` to drop forbidden segments.\n2. Consolidate the three copies of `setNestedValue`/`getNestedValue` (routes-workflow, routes-adaptive, routes-hench) into one shared, prototype-safe helper so this class of bug cannot recur per-file."
lastModified: "2026-09-11T19:42:15.634Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
