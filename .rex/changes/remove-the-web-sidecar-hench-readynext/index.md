---
id: "0d9cab12-4094-4e88-a428-abb7b8e7292b"
type: "change"
title: "Remove the web.sidecar, hench.readyNext and git.branchHealth toggles"
slug: "remove-the-web-sidecar-hench-readynext"
intent: "Step 2 of unflagging the Sidecar, from the 2026-11-12 feature-flag audit. Land in the release after the change that turns the three on by default has shipped, so for one release a project can still turn each one off.\n\nRemove the three entries from FEATURE_REGISTRY, their five rows in ROUTE_FEATURE_GATES (packages/web/src/server/route-feature-gates.ts), the toggle reads in the viewer, the hub (HUB_SESSION_FEATURE in hub/session-host.ts, the refusal in hub/proxy.ts, the SIDECAR_OFF case in server/sidecar/hub-snapshot-fetch.ts), the `feature` prerequisites in server/sidecar/lens-packets.ts and the readyNext check in server/routes-sidecar.ts. About 26 test files mention web.sidecar. Remove Live's old Up next list, which Ready next replaced.\n\nOut of scope: the static export keeps the Sidecar off through isDeployedMode, and web.sidecarGithubReads stays."
acceptanceCriteria:
  - "None of the three keys is in FEATURE_REGISTRY or ROUTE_FEATURE_GATES, and no route answers 403 naming them"
  - "A .n-dx.json that still stores any of the three loads without an error, and the stored value has no effect"
  - "No Sidecar lens reports a feature toggle as missing"
  - "Live shows Ready next and no longer has an Up next list"
  - "A patch changeset for @n-dx/web"
touches:
  - "1710be37-554f-47bf-a9e0-609a6ab90768"
  - "ba50eaa7-5f31-4a8d-9e16-6c452882022e"
priority: "medium"
tags:
  - "feature-flags"
  - "web"
  - "sidecar"
source: "ndx-capture"
blockedBy:
  - "f55f5a4c-036a-40b5-b0ee-5ea4b1b586e1"
---
