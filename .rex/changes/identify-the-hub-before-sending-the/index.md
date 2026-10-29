---
id: "6d78bbde-88c9-4932-806c-81eac7164423"
type: "change"
title: "Identify the hub before sending the token"
slug: "identify-the-hub-before-sending-the"
intent: "ensureHub, hubAuthState and the marker-file probes in packages/core/web.js send the per-user token to whatever answers 401 on the hub port or on a port named by a project marker file. Verify the listener is this user's hub before any credentialed request."
acceptanceCriteria:
  - "No request carrying the token is sent to the hub port or a marker-file port until the listener's pid is read from the 0700 ndx home, is alive, owned by the current uid and is the sole listener on that port"
  - "A credentialed probe is never sent to a marker-file port that is not the configured hub port"
  - "An integration test runs a 401-answering stub on the hub port and asserts it never receives the token header while ndx start, status and stop are run against it"
touches:
  - "e96db771-5ed0-4ba8-a70b-74a30f462f65"
priority: "high"
source: "ndx-capture"
---
