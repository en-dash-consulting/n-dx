---
id: "b3d2d62d-051a-4e27-af7a-2c4d156b07da"
type: "change"
title: "n-dx's own config writers coordinate with an active run's backstop"
slug: "n-dx-s-own-config-writers-coordinate"
intent: "Second short adversarial re-review of #816 + #817 (the 20 fix commits since abf90b308; two parallel passes, trust/config and child-env/spawn/backstop; fix/security-child-env at 9b60c492e), 2026-10-28, child-env pass finding 3, the design half. The stack's task only reports it honestly and documents it.\n\nProblem: the backstop cannot tell a user's dashboard or `ndx config` save during a run from an agent's write, so it reverts both. Any coordination record in the checkout or the home directory can be forged by an agent with shell access. Options: (a) the dashboard and `ndx config` refuse or queue config writes while a run holds the PRD lock or a run marker, and apply them when the run ends; (b) the writers go through the running hench process (an IPC request), which re-snapshots after applying; (c) accept and document the revert (the stack's minimum). Recommended: (a), since queueing is simple and cannot be forged by a write the agent controls."
acceptanceCriteria:
  - "A user's config save made through n-dx while a run is active is applied after the run instead of being reverted"
  - "An agent cannot use the same path to get a config write accepted"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "medium"
discoveredFrom: {"item":"bfb205e4-24e7-4d4e-b77a-ed3190d428e9"}
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
