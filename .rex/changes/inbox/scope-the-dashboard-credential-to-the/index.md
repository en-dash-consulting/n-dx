---
id: "a77e4f59-f13b-4575-96da-0ba971eb68f6"
type: "change"
title: "Scope the dashboard credential to the origin"
slug: "scope-the-dashboard-credential-to-the"
intent: "The ndx_token cookie is host-scoped, so any localhost server the operator opens receives it, and the printed and opened URL carries the token itself. Replace the cookie with a per-origin credential obtained by exchanging a single-use nonce."
acceptanceCriteria:
  - "The dashboard no longer sets an ndx_token cookie; the landing URL carries a single-use short-lived nonce that the page exchanges for a credential kept in sessionStorage and sent as the X-Ndx-Token header"
  - "WebSocket upgrades authenticate with a short-lived ticket issued to an authenticated page, not a cookie"
  - "The URL printed by ndx start and passed to the browser opener contains the nonce only, never the per-user token"
  - "A test asserts that a request from a different loopback port carrying the old cookie is answered 401"
priority: "high"
source: "ndx-capture"
---
