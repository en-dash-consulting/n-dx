---
id: "ffbb80bf-08b2-48e4-94e2-7395bca0a7a8"
type: "change"
title: "No test checks that buildPackImportGraph passes unparsed pack files to the resolver"
slug: "no-test-checks-that"
intent: "Verdict: should-fix (medium). Found in the review of 0307f4fb. packages/sourcevision/src/analyzers/pack-imports.ts parsePackFiles now collects oversized or unreadable pack files as `unparsed` and passes them to resolver.prepare(parsed, unparsed). Only tests/integration/go-resolver.test.ts covers the Go resolver's use of `unparsed`, and that test builds the list in its own helper. Scenario: someone drops the `unparsed.push` in parsePackFiles, or stops passing it to prepare. Every test still passes, yet once ab5f9130 routes Go through the pack, a package whose only file is a 1.5 MB api.pb.go loses its edge again. Reachability: unreachable in production today, because Go has no resolver attached and Java ignores `unparsed`. It becomes reachable with ab5f9130. Options: (1) In tests/unit/analyzers/pack-imports.test.ts, give a pack a recording resolver, put an inventory entry for a missing (unreadable) file of that pack in the inventory, and assert that the path reaches prepare's second argument. Cheap, and recommended. (2) Add the oversized-only case to ab5f9130's end-to-end imports tests. That costs more, and it waits on the switch."
acceptanceCriteria:
  - "A test of buildPackImportGraph asserts that a pack file the runner did not parse (unreadable or oversized) reaches resolver.prepare as an unparsed path"
  - "That test fails when parsePackFiles stops collecting unparsed paths or buildPackImportGraph stops passing them"
touches:
  - "72b0abf4-b4be-4c2a-8336-dd84824ed71b"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "language-packs"
  - "go"
source: "ndx-adversarial-review"
---
