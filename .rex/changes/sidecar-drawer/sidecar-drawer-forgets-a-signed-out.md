---
id: "0c8f67c5-719b-4570-9e5a-5296f7c19129"
type: "task"
title: "Sidecar drawer forgets a signed-out vendor CLI on page reload"
slug: "sidecar-drawer-forgets-a-signed-out"
description: "Verdict: should-fix (low). Scenario: a turn fails with the Claude sign-in error; the closing sidecar:frames announcement carries signedOut and the drawer shows state A with `claude /login`. Reload the dashboard: useSidecar's lastTurn starts null and the frames route carries no turn outcome, so state A is gone; only the transcript's failure row remains, without the login command, until the next turn fails again. Evidence: packages/web/src/server/routes-sidecar.ts startTurn (signedOut only on the socket announcement); packages/web/src/viewer/hooks/use-sidecar.ts lastTurn (in-memory only). Reachable from any reload or a second tab. Options: (a) persist the last turn's outcome (status, error, signedOut) on the session record and return it from GET …/sessions and …/frames — small, recommended; (b) classify a `failure` frame's message on the server and mark the frame — couples the frame schema to auth classification."
acceptanceCriteria:
  - "After a turn fails with the vendor sign-in error, reloading the dashboard and opening Sidecar still shows state A with the vendor login command (tested)"
  - "A later successful turn clears the persisted signed-out outcome (tested)"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
