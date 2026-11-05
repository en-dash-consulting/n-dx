---
id: "9e47fb80-238b-4cff-a0df-254bce7a8da1"
type: "task"
title: "No test covers the dashboard server accepting a Sidecar broker key, so dropping the start.ts wiring would 401 every broker call unnoticed"
slug: "no-test-covers-the-dashboard-server"
description: "Verdict: should-fix (low). Found by an adversarial review of task 5845d911 (run 2117658c).\n\nEvidence: packages/web/src/server/start.ts createHttpServer passes `scopedCredential: isSidecarBrokerRequest` to handleRequestSecurity. The integration test (tests/integration/sidecar-broker-credential.test.ts) builds its own gate-plus-routes handler, and unit tests call isSidecarBrokerRequest directly. Nothing exercises the production server's wiring.\n\nScenario: a refactor of createHttpServer drops the option (or the preview server pattern `{ token }` is copied over it). Every test stays green. With auth on (the default), the Sidecar CLI's broker requests get 401: the session has no broker tools, and no card is ever raised.\n\nReachable: every Sidecar session under `ndx start` with auth on.\n\nOptions:\n(a, recommended) In an integration test that starts the real server in-process with a token (as hub-auth-token / server-start tests do), mint `sidecarBrokerCredential(\"unknown-id\")` in the same module instance and POST to /api/sidecar/sessions/unknown-id/mcp with only the key. Assert the answer is not 401 (the route answers 404 for an unknown session), and that the same key on GET /api/sidecar/sessions answers 401. This is cheap and needs no vendor CLI.\n(b) Drive a full session through the real server with a fake CLI. This costs more: it needs a spawn seam on the default registry."
acceptanceCriteria:
  - "A test starting the real dashboard server with a token gets a non-401 answer to POST /api/sidecar/sessions/<id>/mcp presenting only that session's broker key"
  - "The same test gets 401 when the same key is presented on another route"
  - "Removing `scopedCredential: isSidecarBrokerRequest` from start.ts makes that test fail"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "sidecar"
source: "ndx-adversarial-review"
---
