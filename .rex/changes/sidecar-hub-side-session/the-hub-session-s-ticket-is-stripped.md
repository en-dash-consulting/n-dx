---
id: "8981254d-f128-4a04-9b3a-fc06ca075754"
type: "task"
title: "The hub session's ticket is stripped before the upgrade reaches the host"
slug: "the-hub-session-s-ticket-is-stripped"
description: "Review of #948 (finding F1, remaining gap): the /p/<id> upgrade strips the spent ?ticket= before forwarding with hub.token, but the hub-session upgrade forwards decision.path with the ticket still on it. Mirror the /p/<id> branch. Runs first: it is the smallest of the three and touches src/hub/proxy.ts only."
acceptanceCriteria:
  - "decideProxy's hub-session path drops the ticket query parameter (TICKET_QUERY_PARAM) as it already drops the token one, so neither an HTTP forward nor an upgrade carries it to the host"
  - "A proxy-decide unit test shows a /hub/session/ path with ?ticket= and other query parameters decides to a path without the ticket and with the others kept"
  - "A hub-session-proxy integration test shows the upstream's upgrade request carries x-ndx-token and no ticket parameter"
priority: "medium"
source: "adversarial-review"
---
