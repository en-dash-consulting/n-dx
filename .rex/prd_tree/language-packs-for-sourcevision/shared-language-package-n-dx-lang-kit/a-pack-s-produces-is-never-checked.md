---
id: "c634a331-1abb-4d4b-97fa-b7abd9bf0c1c"
level: "task"
title: "A pack's `produces` is never checked against what pack-facts can read, so a mismatch drops facts silently"
status: "completed"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-kit"
  - "pack-contract"
source: "ndx-adversarial-review"
startedAt: "2026-10-13T15:45:40.020Z"
completedAt: "2026-10-13T15:50:08.158Z"
endedAt: "2026-10-13T15:50:08.158Z"
resolutionType: "code-change"
resolutionDetail: "buildPackImportGraph degrades (one notice, fallback named) a resolver pack whose produces omits imports; readSymbols throws for a pack without SYMBOL_RULES; new factGaps(pack) names both gaps."
acceptanceCriteria:
  - "A pack-imports test with a pack that has a resolver but produces [] fails today (no edges, not degraded) and passes once the mismatch is reported or degraded"
  - "A pack-facts test with a pack that produces symbols but has no SYMBOL_RULES entry is reported, not silently given an empty list"
description: "Verdict: should-fix (low). Found by the adversarial review of 8fab5dc4.\n\nScenario A: a pack with a resolver whose `produces` omits \"imports\" (for example a PR 12 pack package that forgets it). In packages/sourcevision/src/analyzers/pack-imports.ts, buildPackImportGraph still counts the pack as present (filtered on `resolver` only) and parses every file, but readPackFacts returns no `imports`, so `if (!imports) continue;` drops every edge. The pack is not listed in `degraded`, nothing is warned, and Go's regex fallback does not run. The graph silently loses that language's edges.\n\nScenario B: a pack that lists \"symbols\" in `produces` but has no SYMBOL_RULES entry for its id (pack-facts.ts) gets `symbols: []`, which reads as \"declares nothing\".\n\nReachable: not with the built-in packs (java and go produce imports; java, go and sql have rules). It becomes reachable when PR 12 moves packs into their own packages.\n\nOptions:\n1. (Recommended) Assert consistency at load time. loadLanguagePacks, or packsFor/buildPackImportGraph, rejects or degrades with a notice a pack that has a resolver but does not produce \"imports\", and a pack that produces \"symbols\" without a rule. Cost: a few lines plus tests. Risk: low.\n2. Derive `produces` from the pack's capabilities instead of declaring it. Cost: higher, and it changes the contract's FactProducer."
lastModified: "2026-10-13T15:50:08.445Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
