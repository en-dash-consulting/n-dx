---
id: "56654c08-e600-405f-aeb0-240e3de5c7b0"
level: "task"
title: "List Java as analysed only when the Java pack ran"
status: "in_progress"
priority: "high"
tags:
  - "review-fixes"
  - "sourcevision"
  - "lang-java"
  - "pr-17"
source: "review"
startedAt: "2026-10-17T03:51:37.334Z"
acceptanceCriteria:
  - "Without the Java pack, a Java-root repo's analysedLanguages omits Java; with it, Java is listed after the imports phase"
  - "A --phase=2 re-run after removing the Java pack drops Java"
  - "Only analysedLanguages changes; tests cover both paths"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"},"contextNotes":"The hench sandbox may block the network and ~/.cache corpora. If it does, leave the corpus and byte-identity checks to the session, which verifies them; do not capture follow-ups for them."}
description: "Stack review (#771). From 12a on, Java analysis needs the opt-in @n-dx/lang-java, but javaConfig and its detection live in lang-kit and always run, and javaConfig.parseableExtensions is {\".java\"}. So in a Java-root repo without the pack, analyzeInventory still lists \"Java\" in summary.analysedLanguages, while imports.json has no Java edges, and the dashboard's language strip shows Java as analysed. PR 15 and 16c solved this for Python with PACK_ONLY_CONFIGS and withPackAnalysedLanguages in packages/sourcevision/src/analyzers/inventory.ts, which at the stack top is still [pythonConfig] only.\n\nFix: add javaConfig, and javaSecondaryConfig if it carries .java, to PACK_ONLY_CONFIGS, so Java is listed only when its pack ran (16c's set-exactly semantics). The expected change is to inventory.json's analysedLanguages only: with the Java pack, Java is still listed after the imports phase; without it, it is not. Tests: a no-pack Java-root assertion, a with-pack assertion, and a --phase=2 re-run after the pack is removed, as 16c did for Python."
lastModified: "2026-10-17T03:51:37.617Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
