---
id: "39667967-032d-49d8-bad5-d31af2df8b0e"
type: "task"
title: "Re-adding a removed connection's id at another URL sends the token it kept to the new server"
slug: "re-adding-a-removed-connection-s-id-at"
description: "Found by the adversarial review of task 920b0ec3 (run d7816262). Verdict: should-fix, severity medium.\n\nScenario: the operator removes connection `docs` (auth token) without ticking \"Also delete the stored credential\", so DELETE /api/connections/docs keeps connection:docs (routes-connections.ts, DELETE branch). Later they add a different server under the same id with auth token and no token typed: POST /api/connections writes the declaration, and ConnectionService.transportFor reads connection:docs and sends it as the bearer to the new URL (connection-service.ts transportFor, auth \"token\"). The old server's token reaches a server it was never issued for, and the row reads \"connected\" or \"sign in again\" with no hint that an old token was used. The same applies to an OAuth record kept under the id.\n\nReachable: yes, Settings > Project > Connections: Remove (default keeps token), then Add with the same id.\n\nOptions:\n(A, recommended) Bind the stored credential to the URL it was stored for: record the url host beside connection:<id> (or in the entry), and on connect refuse a token whose recorded host differs (\"the stored token was for <host>; store a new one\"). Cost: a field in the stored entry and one check; risk: entries stored before the change carry no host (treat as unbound, or as needing re-entry).\n(B) On add, when connection:<id> already exists and no token is typed, refuse with 409 \"a credential is stored for <id>; delete it or type a new token\". Cheap, UI-only protection; does not cover hand edits of .n-dx.local.json.\n(C) Make Remove delete the credential by default. Changes a deliberate decision (the operator keeps the token on remove)."
acceptanceCriteria:
  - "Adding a token connection whose id has a credential kept from a removed connection, with a different URL and no token typed, sends no Authorization header to the new server (test against two fake HTTP servers)"
  - "The add or the connection's status names that a stored credential exists for that id and was not used"
  - "Re-adding the same id at the same URL still works with the kept token"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
