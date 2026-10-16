---
id: "5ab436bd-5f7b-4973-a6cf-e5dd221ba8fc"
level: "task"
title: "An imports-only re-run keeps Python in analysedLanguages after the Python pack is gone"
status: "in_progress"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "language-packs"
  - "lang-python"
  - "sourcevision"
source: "ndx-adversarial-review"
startedAt: "2026-10-16T16:47:33.158Z"
acceptanceCriteria:
  - "withPackAnalysedLanguages removes a pack-only language (Python) from analysedLanguages when its pack is not among the packs that ran"
  - "Given an inventory.json that lists Python as analysed, runImportsPhase with the Python pack missing writes an inventory.json that no longer lists Python"
  - "Without the pack, a full analyze still leaves inventory.json byte-identical (no rewrite by the imports phase)"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"Take option 1. A pack that loaded but degraded did not run, so its language is removed too. When the pack-only set does not change, return the same summary object and do not rewrite inventory.json, so a fresh analyze without the pack, and one with it, stay byte-identical to today (the session verifies this on the corpus). Add an analyze-level test for the --phase=2 re-run after the pack is removed. Ship as one commit on feat/sv-lang-pr16c-analysed-languages with a @n-dx/sourcevision patch changeset. The hench sandbox may block ~/.cache; if it does, leave the corpus checks to the session; do not capture follow-ups for them."}
description: "Verdict: should-fix (adversarial review of 7df42c8a9).\n\nScenario: run `sv analyze` with @n-dx/lang-python installed. The imports phase adds \"Python\" to inventory.json `summary.analysedLanguages` (analyze-phases.ts runImportsPhase → withPackAnalysedLanguages). Then remove the pack (`ndx sv pack remove python`) and run `sv analyze --phase=2`, which re-runs imports without phase 1. imports.json loses every Python edge. inventory.json still lists Python as analysed, because withPackAnalysedLanguages (packages/sourcevision/src/analyzers/inventory.ts) only adds languages and never removes them. The web language-analysis strip then reports Python as analysed when it was not.\n\nA full analyze is not affected, because phase 1 rewrites the summary without Python.\n\nReachable through `sv analyze --phase=2` (or `--phase=imports`) after a pack install changes.\n\nOptions:\n1. (Recommended) Make the helper set the pack-only languages to exactly those whose pack ran: drop a pack-only language whose pack did not run, and add one whose pack did. It returns the same object when nothing changes, so a fresh analyze without the pack stays byte-identical. The cost is a few lines plus one test.\n2. Leave it as is and document that an imports-only re-run after removing a pack needs a full analyze. Free, but the strip stays silently wrong."
lastModified: "2026-10-16T16:47:33.466Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
