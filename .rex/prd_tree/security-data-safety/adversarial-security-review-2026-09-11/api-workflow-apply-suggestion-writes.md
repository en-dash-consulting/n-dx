---
id: "d8d1d03d-61d7-4a7d-8ed9-24d285da86a0"
level: "task"
title: "`/api/workflow/apply-suggestion` writes arbitrary dotted keys into `.hench/config.json`"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "security"
  - "severity:medium"
  - "web"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A `changes` object containing a key outside the suggestion allowlist returns 400 and `.hench/config.json` is unchanged"
  - "A `changes` key containing `__proto__`, `constructor`, or `prototype` as any segment returns 400"
  - "A value of the wrong type for an allowlisted key (e.g. string for `maxTurns`) returns 400"
  - "The allowlist is derived from (or asserted equal to) the set of keys the suggestion generator can emit, so a new suggestion type cannot silently be unappliable or unguarded"
  - "Unit tests for the three rejection cases and one accepted case"
description: "**Severity:** medium · **Verdict:** should-fix (defense-in-depth)\n\n**Failure scenario.** `POST /api/workflow/apply-suggestion` with `{\"changes\": {\"guard.allowedCommands\": [\"sh\",\"curl\"], \"permissionMode\": \"bypassPermissions\", \"guard.blockedPaths\": []}}` rewrites `.hench/config.json` with exactly those values — `handleApplySuggestion` iterates `changes` and calls `setNestedValue(config, key, value)` with no key allowlist and no value validation. `setNestedValue` also accepts `__proto__` / `constructor` path segments. The next autonomous hench run then executes with no command allowlist, no blocked paths, and bypassPermissions.\n\nToday this needs a same-origin caller: the Origin/Sec-Fetch-Site guard blocks cross-site POSTs, and the review found no XSS primary in the viewer. So the exploit requires either a future XSS or a local process — but the endpoint exists to apply *machine-generated suggestions*, which have a known, small key set; accepting anything is unnecessary blast radius.\n\n**Evidence.** `packages/web/src/server/routes-workflow.ts:580-630` (`handleApplySuggestion`), `:432-442` (`setNestedValue`), `:498` (dispatch).\n\n**Reachability.** Same-origin only; no current primary. Reported as defense-in-depth.\n\n**Solution options.**\n1. *(Recommended)* Allowlist the dotted keys the suggestion generator emits (derive it from the same table the generator uses so they cannot drift), reject anything else with 400, and reject path segments `__proto__`, `constructor`, `prototype`. Validate value types against the hench config schema (`schema/validate.ts` already has a zod schema) before writing. Cost: small.\n2. Route the write through hench's own config-validate path so a malformed config is rejected before it lands on disk. Good in addition to 1."
lastModified: "2026-09-11T17:37:53.800Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
