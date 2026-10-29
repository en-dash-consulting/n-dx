---
id: "9171679e-18fb-4773-8ec6-cc42f7984420"
type: "task"
title: "Package text reaches the terminal raw in the unknown-command hint, and bidi controls pass validation"
slug: "package-text-reaches-the-terminal-raw"
description: "Verdict: should-fix. handleUnknownCommand prints resolution.hint (packages/core/cli.js:3584-3591, extension-dispatch.js:425-428) unescaped; a cloned repo's invalid or incompatible package (validation returns early) with version '1.0.0\\u001b[2K...' reaches the terminal raw on `ndx x`. The control-character rule (extension-manifest.js:253, \\p{Cc}) does not cover bidi format controls such as U+202E, which can visually reorder a printed line. Fix: escape package text wherever a resolution message or hint is printed; add U+202A-202E and U+2066-2069 to the rule and the escaper."
acceptanceCriteria:
  - "No package-supplied text is printed raw by the unknown-command hint, covered by a test"
  - "A manifest string with a bidi control character is invalid under the control-character rule"
priority: "low"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
