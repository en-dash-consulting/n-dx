---
id: "77cd6136-39b4-4992-9153-126cc513704b"
type: "task"
title: "Connection badge infers \"sign in again\" from the server's reason text, so a refused token on a token-auth connection reads \"sign in\""
slug: "connection-badge-infers-sign-in-again"
description: "connectionStateLabel (packages/web/src/viewer/views/connections.ts:42) returns \"sign in again\" only when row.reason contains \"sign in again\". The server words that text in oauth-provider.ts (SIGN_IN_AGAIN, URL_CHANGED), but a token-auth connection whose stored token is refused gets reason \"the server refused the stored token\" (connection-service.ts:393), so its badge reads \"sign in\" although it had a token and lost it. The viewer also breaks silently if the server rewords its reasons. Reachable: GET /api/connections → Settings > Project > Connections. Verdict should-fix (adversarial review of e98b1054): no wrong action follows, only wording, but the coupling is fragile. Options: (A, recommended) the server adds a structured field to the row, e.g. `hadToken: boolean` or `signIn: \"first\" | \"again\"`, set where it builds the reason, and the viewer reads that field. That's a small server change plus a route test. (B) Share the reason constants through src/shared/. That's cheaper, but the badge still depends on wording."
acceptanceCriteria:
  - "A token-auth connection whose stored token the server refused reads \"sign in again\" in Settings > Project > Connections (viewer test)"
  - "The badge is decided by a structured field on the connection row, not by matching the reason text (route test asserts the field for never-signed-in, refused and signed-out rows)"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
