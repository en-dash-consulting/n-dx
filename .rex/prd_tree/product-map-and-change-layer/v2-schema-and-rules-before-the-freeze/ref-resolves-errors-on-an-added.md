---
id: "a55c7225-d9fc-451b-9b52-d48773e0f0fb"
level: "task"
title: "ref-resolves errors on an added amendment placed under a node another open change adds"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "checkV2Rules reports no ref-resolves finding for an added amendment whose under names a node another open change adds (or, under option b, the v2 schema doc states that stacked adds are refused until apply)"
  - "tests/unit/schema/v2-rules.test.ts has a fixture with two changes, one adding a parent and one adding under it, asserting the decided behaviour"
description: "Verdict: should-fix (low), from the adversarial review of ba39230d.\n\nScenario: change A has `{ target: \"new-area\", delta: \"added\", type: ... }` and is not yet applied; change B has `{ target: \"new-cap\", delta: \"added\", under: \"new-area\" }`. checkV2Rules reports ref-resolves (error) on B: \"added amendment under \\\"new-area\\\" names no node\". refResolves (packages/rex/src/schema/v2-rules.ts, the `added` set) only exempts `under` refs that name a node the *same* change adds, so stacked changes (one adds a parent, a later one adds under it) read as a dangling-reference error until A is applied.\n\nReachable: through authored change frontmatter once the v2 store is wired (PR 10 apply, PR 12 placement). Not reachable today: v2 is unwired.\n\nOptions:\n(a) Collect added targets from every open change, not just the same one, and accept an `under` that names one of them. Cheap: one set built before the flatMap, one test. Risk: a change can then depend on another change's unapplied add with no ordering edge; apply (PR 10) must apply A before B or refuse.\n(b) Keep the error and require the later change to wait for A's apply (or name A in blockedBy). No code change; document it in the v2 schema doc.\nRecommendation: (a) plus a requirement that B carries blockedBy A, checked by the same rule. Decision for Ryan: are stacked adds allowed before apply?"
lastModified: "2026-10-08T00:33:35.202Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
