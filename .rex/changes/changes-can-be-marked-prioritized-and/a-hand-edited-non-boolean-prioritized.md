---
id: "765041f5-8f7e-4f95-b5c8-0c907706dafd"
type: "task"
title: "A hand-edited non-boolean prioritized hides the change and can block PRD writes"
slug: "a-hand-edited-non-boolean-prioritized"
summary: "If someone types the prioritized marker by hand slightly wrong, such as 'True' or '1', the whole change silently disappears from the plan and may stop further edits being saved. This tolerates the typo and warns instead."
description: "Verdict: should-fix (severity medium), from the adversarial review of feat/prioritized-changes (faeb63a8f).\n\nThe changeset tells users the flag lives in index.md frontmatter. Probe: `prioritized: True` reads as the string 'True'; `\"true\"` as a string; empty as null; `1` as a number — all fail z.boolean() (packages/rex/src/schema/v2.ts:466). Before this branch the key was passthrough and harmless; now store/prd-model-reader.ts:427-430 skips a node with invalid intent, so the change and its tasks drop out of get_next_task and the dashboard. Traced (not executed): writePrdModel then treats the hidden folder as stale and assertStaleRemovable refuses, so every v2 write fails until the file is fixed by hand. Precedent: dropNonObjectRun guards the same failure for run.\n\nFix (recommended, ~10 lines + reader test, low risk): drop or normalise a non-boolean prioritized before intent validation, with a warning, like dropNonObjectRun. Alternative z.preprocess coercion hides typos."
acceptanceCriteria:
  - "A change whose index.md has prioritized set to a non-boolean value (True, \"true\", 1, empty) still loads, with a warning naming the file"
  - "A v2 write succeeds while such a file is present"
  - "A reader test covers the non-boolean values"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
