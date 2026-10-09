---
id: "33443098-9b72-4313-b8b6-dc7b86bdd403"
level: "task"
title: "Placement seams and passes read rex.placement from two separate inputs, so a caller that passes it only to placementSeams has a configured Jev ignored"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "A plan built with seams from placementSeams({settings: {models: \"jev\", autoAccept: \"confident\"}, ...}) and no options.placement still runs Jev and places a confident pick (test)"
  - "A seam supplied for a tier the effective settings exclude either runs or fails loudly; it is never listed in the header as a pass that asked nothing (test)"
description: "Verdict: should-fix (low). The defect is contract drift; nothing fails today.\n\nScenario: the caller (the future `migrate --plan`) builds seams with `placementSeams({ settings: { models: \"jev\", autoAccept: \"confident\" }, jev, jevAvailable: true })` and omits `options.placement` from the plan context. `questionsFor` (packages/rex/src/migrations/v1-to-v2/placement-pass.ts, `settingsOf`) falls back to DEFAULT_PLACEMENT_SETTINGS (`text`/`agree`), so the jev pass asks nothing. The header still lists a jev pass and no change is placed, and nothing warns. The reverse mismatch also happens: seams built for `both` while the options say `text` makes the text pass decide alone.\n\nReachable once a command calls `placementSeams`; no caller exists today. Introduced by 0734e6b6.\n\nOptions:\n1. (Recommended) Make one input authoritative. Either `placementSeams` returns `{ seams, options }` for the caller to spread, or the passes read the settings recorded on the seams. Cost: a small API change plus a test.\n2. Have `runPlanPipeline` or the passes throw when a seam exists for a tier the settings exclude. Cost: a few lines; it catches the mismatch but keeps two inputs."
lastModified: "2026-10-08T23:45:28.885Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
