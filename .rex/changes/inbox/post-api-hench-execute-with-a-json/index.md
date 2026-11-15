---
id: "502a58c1-69d6-43e8-8e86-19ec028085fc"
type: "change"
title: "POST /api/hench/execute with a JSON null, false, 0 or empty-string body never gets a response"
slug: "post-api-hench-execute-with-a-json"
intent: "packages/web/src/server/routes-hench.ts handleExecuteCheck (~1943) and handleExecute (~1961) do `if (!body) return true`: the route claims the request but writes nothing, so the client hangs until it times out. Repro: `POST /api/hench/execute` with body `null`.\n\nReachable: yes, by any client sending a falsy JSON body (not the dashboard today).\n\nFix options: (1, recommended) answer 400 \"Request body must be a JSON object\" when the body is not an object, as other routes do; small.\n\nVerdict: out-of-scope for the streamline refactor stack (pre-existing, found by its adversarial review, 2026-11-15); worth fixing on its own."
acceptanceCriteria:
  - "POST /api/hench/execute and the execute check answer 400 for a JSON null, false, 0 or empty-string body"
  - "A route test sends each falsy body and asserts a 400 response"
priority: "medium"
source: "ndx-adversarial-review"
---
