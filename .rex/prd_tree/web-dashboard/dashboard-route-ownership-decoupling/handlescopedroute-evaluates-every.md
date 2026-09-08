---
id: "56d25253-371b-472e-b50e-b215f0a3ae44"
level: "task"
title: "handleScopedRoute evaluates every scoped route handler before checking scope"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "web"
  - "server"
  - "pre-existing"
blockedBy:
  - "5a895e9d-b34e-402f-9839-9296c25080fc"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "handleScopedRoute cannot be called with an already-invoked handler — the signature takes a thunk (or equivalent) so eager evaluation is a type error"
  - "A test asserts that for each scoped route, an out-of-scope request to that route's path leaves the handler unexecuted (no response write, no side effect) and produces no unhandled rejection"
  - "The regression is covered for at least one non-sourcevision route — e.g. POST /api/notion/sync under scope \"sourcevision\" — and that test fails on the current code"
  - "All eight existing handleScopedRoute call sites are migrated, verified by the absence of the old two-argument form in start.ts"
  - "The ask route's interim guard from the blocking item is folded into the general mechanism rather than left as a one-off"
  - "Every scoped route still answers normally when its package is in scope, or scope is unset (full web suite green)"
description: "Verdict: out-of-scope for the branch that revealed it — pre-existing on main. Severity: high.\n\nFAILURE SCENARIO\npackages/web/src/server/start.ts:590:\n\n  async function handleScopedRoute(enabled: boolean, result: RouteResult): Promise<boolean> {\n    if (!enabled) return false;\n    return await resolveRouteResult(result);\n  }\n\n`result` is a value parameter, so every caller has already invoked its handler by the time the guard is read. When `enabled` is false the promise is neither awaited nor cancelled: the handler runs to completion, writes to a response the dispatcher has since finished with, and throws an unhandled rejection that terminates the process.\n\nReproduced independently of the new ask route — server started with scope \"sourcevision\", one POST to /api/notion/sync:\n  UNHANDLED: ERR_HTTP_HEADERS_SENT Cannot write headers after they are sent to the client\n\nREACH\nEight call sites share the shape: start.ts:611, :614, :615, :620, :629, :635, :636, :637, :638, :640, :641. Each pairs a scope check with an eagerly-invoked handler. Handlers that early-return on a path mismatch are harmless for unmatched paths; the failure needs a path that matches a handler whose package is out of scope. `--scope` is documented at packages/core/help.js:1007 (`ndx dev --scope=<pkg>`).\n\nThe routes are not reachable cross-origin (request-security.ts rejects cross-origin POSTs), so the caller is local — curl, a script, or a viewer built for a different scope.\n\nWHY IT IS FILED SEPARATELY\nThis is pre-existing behaviour, not something the current branch introduced. It is reported on its own item rather than folded into the ask-route fix, per the adversarial-review scope rule. The ask route is filed separately because its own comment asserts the guard works and because it is the only handler that spends money before the guard.\n\nSOLUTION OPTIONS\n(a) RECOMMENDED — change the signature to take a thunk:\n      async function handleScopedRoute(enabled: boolean, run: () => RouteResult): Promise<boolean> {\n        if (!enabled) return false;\n        return await resolveRouteResult(run());\n      }\n    Then update all call sites to `() => handleXRoute(...)`. The compiler finds every one, so the migration is mechanical and complete. Cost: a diff across seven routes that currently work.\n(b) Leave the signature and make each call site guard first (the shape used at :626 and :633). Smaller per-site change, but preserves a footgun that the next added route will step on — which is exactly what happened here.\n\nRecommend (a): it makes the wrong thing unrepresentable rather than relying on each author remembering. Do it after the ask-route one-liner lands, then remove that special-casing.\n\nFound by /ndx-adversarial-review while reviewing branch fix/coding-prompts-and-workflows."
lastModified: "2026-09-08T21:06:35.640Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
