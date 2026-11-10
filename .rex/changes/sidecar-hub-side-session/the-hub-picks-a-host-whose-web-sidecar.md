---
id: "2b2b2441-2c3d-43c9-85a1-99049f429b7b"
type: "task"
title: "The hub picks a host whose web.sidecar is off, so the hub session refuses while another project could host it"
slug: "the-hub-picks-a-host-whose-web-sidecar"
description: "Verdict: should-fix (medium), from the adversarial review of a23d8599.\n\nScenario: two projects are registered, alpha and zeta. web.sidecar is off by default; the operator turns it on in zeta only. HubSessionHostPicker.pick (packages/web/src/hub/session-host.ts) takes the first healthy project in sorted order, which is alpha, so every /hub/session/ request is answered 403 by alpha's route feature gate, naming web.sidecar. The hub session never works, even though zeta could host it, and the refusal points at a project the operator never meant to configure. The acceptance criterion says \"the first reachable registered project\", so this follows the letter of the spec. It defeats its purpose on any machine where the operator enables the Sidecar in only some projects.\n\nReachable: GET/POST /hub/session/* with several projects registered and web.sidecar on in any of them but the first.\n\nOptions:\n1. (recommended) Skip a 403 from the feature gate the same way an unreachable host is skipped: markUnreachable on a refusal that names web.sidecar, so the next request moves on. Cheap, and keeps the hub ignorant of project config.\n2. Have the hub read each candidate's web.sidecar (GET /api/features) before picking. One more read per request, or a cache to keep fresh.\nDecision for the operator: whether a project with web.sidecar off may ever host the session, or whether the hub should say \"turn web.sidecar on in some project\" only when none has it."
acceptanceCriteria:
  - "With two healthy projects where only the second has web.sidecar on, a /hub/session/ request reaches the second project's hub-session routes"
  - "With no project having web.sidecar on, /hub/session/ answers with a refusal naming web.sidecar"
  - "A test in tests/integration/hub-session-proxy.test.ts covers both cases"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
