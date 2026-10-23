---
id: "5f66a6e6-de89-4ce3-aef5-5a4019da1ef3"
type: "change"
title: "A pack whose analyzeProject rejects fails the whole imports phase instead of degrading its language"
slug: "a-pack-whose-analyzeproject-rejects"
intent: "Verdict: should-fix (low). Found by adversarial review of a195dc83 (474cff293).\n\nScenario: buildPackImportGraph (packages/sourcevision/src/analyzers/pack-imports.ts) awaits load.entry.analyzeProject(...) unguarded. The entry contract says a pack never throws for grammar/query/build-file failures, but anything else (a resolver bug, readPackFacts throwing, a pack from the per-user dir built against a drifted contract) rejects, and analyzeImports — and with it `sv analyze` — fails for every language, where a missing or invalid pack only degrades its own language.\n\nReachability: real entry point is `sv analyze` on a Java/Go project; needs a pack defect or a third-party/pack-dir pack. Built-in behavior is unchanged from before (the old in-process path also let parse/resolve errors propagate), so this is hardening, not a regression.\n\nOptions: (1) recommended — catch a rejection, degrade with reason `the pack failed (<message>)` and the reinstall remedy, keep Go on the regex fallback; one branch plus a stub-entry test. (2) leave as is and document that pack defects are fatal — cheaper, but a pack-dir install can then break analysis of unrelated languages."
acceptanceCriteria:
  - "A stub pack entry whose analyzeProject rejects yields degraded: [<id>], one notice naming the error, and edges from the other packs and languages"
  - "For Go, a rejecting pack hands Go files to the regex parser"
touches:
  - "2bc7ded9-e12e-4297-bdca-42355e4c7645"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "language-packs"
source: "ndx-adversarial-review"
---
