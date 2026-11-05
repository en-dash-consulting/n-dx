---
id: "42a34384-e328-4c95-8db3-0a96e385b874"
type: "change"
title: "An approved create whose reply names an opaque id cannot link the change"
slug: "an-approved-create-whose-reply-names"
intent: "Verdict should-fix (high). decideTrackerCard (packages/web/src/server/tracker/sync-engine.ts, decideOnce) links an approved create with changeItemLink(rexDir, rexId, workItemId). changeItemLink only accepts a work ref (link-refs.ts normalizeWorkRef: /^[A-Z][A-Z0-9_]*-\\d+$/ or an http(s) URL). executeTrackerCall takes the id from data[itemIdProperty] ?? data.id. The CAOS-shaped fake's default create reply is {id: \"wi-1\"} (tests/fixtures/connections/fake-mcp-tools.mjs:135): an opaque id. If real CAOS answers likewise (a page id, not WM-2054), every approved create logs ok with a problem \"could not link …: \\\"ref\\\" must be a tracker key\", and later move rules still skip the change. Reachable: Live Tracker activity / Plan's Create in tracker approve. Loud, not silent: the entry names the failure. Unverified: the real CAOS reply shape. Options: (A, recommended) add an optional profile property (e.g. tracker.itemRefProperty) naming the reply field that holds the key or URL, read from the create reply or the confirming get_work_item reply, falling back to the id when it is a work ref; cost small, risk a profile schema change. (B) link the opaque id via v1-style links[] on v2 — contradicts the v2 issues contract. Decision for the operator: confirm the real CAOS create/get reply fields first."
acceptanceCriteria:
  - "Approving a create card whose reply names an opaque id plus a tracker key (or URL) links the change to the key, and the entry names no link problem"
  - "A sync-engine test against the fake CAOS server uses a create reply with an opaque id and a key and asserts the change's issues hold the key"
  - "A later run-started event for that change plans a move with the linked key as the work item id"
touches:
  - "7df16224-db25-4a39-81d2-5c5c3904f4b9"
priority: "high"
discoveredFrom: {"item":"57bf05e3-a8f3-4d56-a411-244eb842492e","run":"06531dfc-99a5-472d-aa2f-bc25f5d09755"}
tags:
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
