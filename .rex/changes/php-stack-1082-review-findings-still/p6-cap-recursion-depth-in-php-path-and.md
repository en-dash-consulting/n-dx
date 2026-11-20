---
id: "7969bba2-eb02-4f21-a637-6c0cb4f1f4bb"
type: "task"
title: "P6: cap recursion depth in PHP path and constant evaluation and contain errors from prepare"
slug: "p6-cap-recursion-depth-in-php-path-and"
summary: "Stops one deeply nested or generated file from making the whole PHP analysis fail with a misleading reinstall message."
description: "#1082 review P6 (medium; generated or adversarial input).\n\nTriggers: `include ((((…'b.php'…))))` 6,000 deep, or a chain of about 1,500 dependent `define`s, throws `RangeError` from `evaluatePath`'s `term`/`expression` (`php-includes.ts`) and from `repositoryConstants`. About 10,000 nested closures overflow `scopeNamer`'s `nameOf` (`php-dynamic-code.ts`), so every eval and dispatch site in the repository is lost. `prepare` (`packages/lang-runtime/src/pack-entry.ts`) is not wrapped, so `analyzeProject` rejects; sourcevision then drops every PHP edge and tells the user to \"Reinstall it\", the wrong remedy.\n\nFix: a depth cap (or iterative evaluation) in those three places, giving up on that one expression with a counted notice; and contain an error thrown from `prepare` the way per-file errors are contained, with a notice that names the failure, not a reinstall.\n\nTests (generated input in the test): the three triggers complete with a notice and the rest of the repository's facts intact; a thrown `prepare` gives a notice, not a degraded pack."
acceptanceCriteria:
  - "Deep include nesting, long define chains and deeply nested closures no longer throw"
  - "An error in prepare is contained with an accurate notice"
priority: "medium"
run: {"tier":"standard","review":true,"skipTestGate":true}
tags:
  - "lang-php"
  - "lang-runtime"
  - "hardening"
---
