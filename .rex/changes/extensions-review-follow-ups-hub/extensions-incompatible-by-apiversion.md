---
id: "dc6d3692-a206-4348-ab5e-18cad96e97dc"
type: "task"
title: "Extensions incompatible by apiVersion never appear greyed out on the hub home"
slug: "extensions-incompatible-by-apiversion"
description: "Verdict: should-fix (contract drift). An apiVersion-incompatible extension is listed with manifest null, and homeExtensions (packages/web/src/hub/home.ts:474-479) drops it; only ndxVersion-incompatible ones show. docs/architecture/extensions.md says incompatible ones show greyed out with the reason. Fix: render a card from name and reason when the manifest is null. Also pin SIDECAR_START_TIMEOUT_MS = 20_000 and the home row's 3 s listExtensions race with tests (neither is asserted today)."
acceptanceCriteria:
  - "An apiVersion-incompatible extension appears greyed out on the hub home with its reason"
  - "A test fails if the 20 s sidecar start timeout or the home row's listing time limit changes"
priority: "low"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
