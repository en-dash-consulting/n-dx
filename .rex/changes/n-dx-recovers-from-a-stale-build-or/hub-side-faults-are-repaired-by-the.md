---
id: "bf09d14d-b75d-4d34-88e6-967948cd0e63"
type: "task"
title: "Hub-side faults are repaired by the hub or the next ndx command instead of telling the user to restart"
slug: "hub-side-faults-are-repaired-by-the"
description: "Covers NO_NDX_CLI in packages/web/src/hub/sidecars.ts, 'the hub cannot tell which n-dx binary to run; restart it with ndx start' in packages/web/src/hub/children.ts and routes.ts, the matching log in packages/web/src/hub/hub.ts, and 'Could not stop the <name> sidecar … restart the hub with ndx hub stop' in packages/core/extension-env.js. The next ndx start (or ndx command that talks to the hub) hands the hub its n-dx binary / CLI so it can recover in place, or replaces the hub through the stale-hub path; a sidecar that will not stop is killed and respawned by the hub. SAFETY: the operator's live hub runs on 127.0.0.1:3117 with ~/.n-dx as its home and serves 25 projects. Never run 'ndx hub stop', 'ndx start' or anything that stops, replaces or registers with that hub. Every test and manual check uses a temporary NDX_HOME and a free port (hub.port / --port)."
acceptanceCriteria:
  - "A hub started without an n-dx CLI or binary path learns one from the next ndx start and serves extensions and project servers without a restart"
  - "A sidecar that does not answer its stop request is terminated and restarted by the hub, and the caller gets a result, not a restart instruction"
  - "None of these messages tells the user to run ndx hub stop or ndx start"
  - "Tests cover each fault in a temporary NDX_HOME"
priority: "high"
source: "ndx-capture"
blockedBy:
  - "98e5a4d9-0b50-4124-a5a9-9745366d2af8"
---
