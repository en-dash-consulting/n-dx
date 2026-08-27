---
id: "9c7789b0-1982-4260-82f0-2b5254f94d01"
level: "task"
title: "Verify the corrected MODEL_COSTS prices against Anthropic's published pricing"
status: "pending"
priority: "medium"
tags:
  - "e2e-finding"
  - "cost-estimation"
  - "verification-gap"
  - "severity:medium"
source: "ndx-capture"
acceptanceCriteria:
  - "Every claude entry in MODEL_COSTS is checked against Anthropic's current published per-MTok pricing and corrected if wrong"
  - "The codex, google, and local entries are checked or explicitly declared out of scope"
  - "MODEL_COSTS records when its prices were last verified against the vendor"
  - "The claude-api skill's failure to load inside a hench run is either fixed or noted as a known reviewer limitation"
description: "Task 85923733 committed haiku-4-5 at 1.00/5.00 and opus-4-7 at 5.00/25.00 per MTok (commit 138d9585). The adversarial reviewer flagged that it could not confirm those figures: the claude-api skill — the sanctioned in-repo pricing reference, which explicitly says never to answer LLM pricing from memory — failed to load, and its reference files sit outside the run's allowed directories.\n\nSo the committed numbers are exactly the ones the task description supplied, and their correctness rests on that description rather than on any source that was checked. The reviewer was explicit that a human should confirm them against Anthropic's pricing page. Since MODEL_COSTS drives budget preflight, a wrong figure here silently mis-sizes every cost estimate.\n\nNote the reviewer's related observation: a test pinning exact prices would be tautological against the source and could not detect a real-world vendor price change. Only an external check or a dated periodic review can. Worth deciding whether a \"prices last verified on <date>\" comment belongs in MODEL_COSTS."
lastModified: "2026-08-27T16:49:37.934Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
