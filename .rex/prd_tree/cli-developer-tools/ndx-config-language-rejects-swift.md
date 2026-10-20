---
id: "b4d25aff-a39d-4a76-b4d6-ec1d5a0cb88c"
level: "task"
title: "ndx config language rejects swift, python and java, which sourcevision accepts"
status: "pending"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "`ndx config language java .` succeeds and writes language: java"
  - "`ndx config language swift .` and `ndx config language python .` succeed"
  - "A test fails when core's accepted language ids differ from sourcevision's VALID_LANGUAGE_IDS"
description: "Verdict: out-of-scope (pre-existing; severity medium). packages/core/config.js:163 has VALID_LANGUAGES = typescript, javascript, go, auto. sourcevision's VALID_LANGUAGE_IDS (packages/sourcevision/src/language/detect.ts) also accepts swift, python and now java. Scenario: `ndx config language java .` (or swift/python) is rejected, though sourcevision honours `\"language\": \"java\"` in .n-dx.json when hand-edited. Reachability: direct CLI command. Found while reviewing the Java language registration; the language-packs epic forbids core edits, so it is filed here. Options: (1, recommended) add swift, python and java to VALID_LANGUAGES and the help text at config.js ~2252, plus a test that the two lists agree (a drift test reading VALID_LANGUAGE_IDS from the built sourcevision output, or a shared constant core can read without importing). (2) Accept any string and let sourcevision fall back on unknown ids; loses typo protection."
lastModified: "2026-10-08T01:41:57.144Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
