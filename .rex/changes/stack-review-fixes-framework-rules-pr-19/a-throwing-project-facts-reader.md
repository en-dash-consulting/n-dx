---
id: "47953518-2a78-48b5-8cc0-684576726ec8"
type: "task"
title: "A throwing project facts reader, project notices or symbol refine still costs the whole language its imports"
slug: "a-throwing-project-facts-reader"
description: "Found by the adversarial review of 0635e6f9 (contain a framework rule failure). It is out of scope there, because the code predates that change.\n\nThe scenario: in packages/lang-runtime/src/pack-entry.ts analyzeProject, these still run with no catch inside the try … finally:\n- `options.projectFacts?.(parsed, kinds)`, around line 150 (Terraform resources)\n- `options.projectNotices?.(parsed, kinds)` (Python dynamic imports, run on every Python analyze)\n- `readPackFacts(...)`, which runs symbol rules' `refine` (Python methods, decorators and `__all__`)\n\nIf any of these throws on one file, analyzeProject rejects. sourcevision's buildPackImportGraph (src/analyzers/pack-imports.ts:182) then degrades the pack with \"the pack failed … Reinstall it\". The run loses every import edge for the language, and the remedy points at a reinstall that will not help. This is the same failure the framework fix removed.\n\nReachability: projectNotices and refine run on every Python analyze. No realistic input is known to throw today. Verdict: out-of-scope for 0635e6f9, low severity.\n\nOptions:\n(a) Contain projectNotices the way readFramework does (lose its notices, add one notice), and contain projectFacts per kind (lose resources, add a notice). This is cheap.\n(b) Contain refine per file: fall back to the rule-read symbols and add a notice.\nRecommended: (a) and (b) together. Each is a small helper next to readFramework. Imports must never depend on these optional readers."
acceptanceCriteria:
  - "A pack entry whose projectNotices throws still returns imports and other facts, with a notice naming the failure, and is not degraded"
  - "A pack entry whose projectFacts throws returns no facts of the kinds it produces, plus a notice; imports survive and the pack is not degraded"
  - "A symbol refine that throws on one file keeps that file's rule-read symbols and imports, with a notice"
  - "A test covers each case and fails on the current code"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-runtime"
source: "ndx-adversarial-review"
---
