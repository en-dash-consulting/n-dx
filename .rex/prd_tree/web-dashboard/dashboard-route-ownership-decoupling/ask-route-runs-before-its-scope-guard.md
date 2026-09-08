---
id: "5a895e9d-b34e-402f-9839-9296c25080fc"
level: "task"
title: "Ask route runs before its scope guard, crashing the server on an out-of-scope POST"
status: "pending"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "severity:high"
  - "web"
  - "server"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A test starts the server (or drives handleApiRoutes) with ctx.scope set to \"rex\" and asserts that POST /api/sourcevision/ask returns 404 without emitting an unhandled rejection — this test fails on the current code"
  - "The same test asserts the ask handler's context assembly and model call are never reached when sourcevision is out of scope (no readFile of CONTEXT.md, no client.complete)"
  - "POST /api/sourcevision/ask still answers normally when scope is unset or set to \"sourcevision\" (existing 16 route tests continue to pass)"
  - "The stale comment at start.ts:627-628 is corrected or removed so it no longer claims the handler is gated when it is not"
  - "The server process survives the out-of-scope POST — asserted by process exit code, not only by response status"
description: "Verdict: must-fix. Severity: high.\n\nFAILURE SCENARIO\nStart the server with a package scope that excludes sourcevision (`ndx dev --scope=rex .`, or the `@n-dx/web` CLI's `--scope=`), then `POST /api/sourcevision/ask` with any body. The request returns 404 and the server process then dies with an unhandled rejection.\n\nReproduced against the built dist:\n  STATUS: 404\n  Error [ERR_HTTP_HEADERS_SENT]: Cannot write headers after they are sent to the client\n      at handleSourcevisionAskRoute (.../routes-sourcevision-ask.js:118:13)\n  EXIT CODE=1\n\nMECHANISM\npackages/web/src/server/start.ts:629 calls:\n  await handleScopedRoute(isInScope(ctx.scope,\"sourcevision\"), handleSourcevisionAskRoute(req,res,ctx))\nThe second argument is a promise that has ALREADY been constructed, so the handler begins executing before the guard is consulted. handleScopedRoute (start.ts:590) returns false without awaiting it, handleApiRoutes falls through to the 404 at start.ts:661, and the still-running ask handler later writes to a finished response.\n\nThe in-file comment at start.ts:627-628 claims the opposite (\"it goes through handleScopedRoute rather than being invoked bare\") — it is invoked bare, then its result discarded.\n\nSecondary cost: when `.sourcevision/CONTEXT.md` exists, the handler reaches `client.complete()` and pays for a model call before the crash. This is the only route in the dispatcher that spends money before its guard.\n\nREACHABILITY\n`--scope` is a documented user-facing flag (packages/core/help.js:1007, `ndx dev --scope=<pkg>`). request-security.ts rejects cross-origin POSTs, so the caller is local: curl, a script, or the ask panel once the `sourcevision-ask-panel-text-exchange` item ships. Not remotely exploitable from a web page.\n\nWHY NO TEST CAUGHT IT\nAll 16 cases in packages/web/tests/unit/server/routes-sourcevision-ask.test.ts invoke handleSourcevisionAskRoute directly and none sets ctx.scope, so the dispatcher path in start.ts is never exercised. Full suite (5,207 package tests + 2,348 root tests), typecheck and build are all green on this branch.\n\nSOLUTION OPTIONS\n(a) RECOMMENDED — guard before constructing the promise, matching the synchronous siblings on start.ts:626 and :633:\n      if (isInScope(ctx.scope,\"sourcevision\") && await handleSourcevisionAskRoute(req,res,ctx)) return true;\n    One line. No risk. Does not touch any working route.\n(b) Reshape handleScopedRoute to accept a thunk (() => RouteResult) and update all eight call sites. Fixes the general case too, but touches seven routes that work today. Tracked as its own item; do (a) first, then let (b) remove the special-casing.\n\nCost of leaving it: a single local request terminates the dashboard server. Cost of the fix: one line.\n\nFound by /ndx-adversarial-review on branch fix/coding-prompts-and-workflows (introduced in 700d9e44)."
lastModified: "2026-09-08T21:06:09.663Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
