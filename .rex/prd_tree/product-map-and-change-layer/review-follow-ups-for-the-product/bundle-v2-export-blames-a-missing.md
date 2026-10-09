---
id: "909927eb-12d6-450f-aa40-e95caa1aa138"
level: "task"
title: "Bundle v2 export blames a missing child when the folder's child was skipped as invalid, and drops the reader warning naming it"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "rex"
  - "lane-rex-store"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "Exporting a v2 tree whose folder's only child has invalid intent and whose state.yaml has an extra top-level key fails with a message that names the skipped child file and its reader warning (test)"
  - "The refusal no longer tells the operator to add a child back when a child file exists but was skipped (test)"
description: "Verdict: should-fix (low). Introduced by the dd28f982 fix (assertFolderStateOwners in packages/rex/src/store/prd-model-bundle-v2.ts → packages/rex/src/store/prd-bundle-v2.ts, buildBundleV2).\n\nFailure scenario (reproduced against the built dist): copy the v2 fixture, set `type: \"bogus\"` in product/checkout/pay-by-card.md, append `futureTop: 1` to product/checkout/state.yaml. exportV2Bundle throws \"Folders with no children keep top-level state.yaml keys ... product/checkout/ (futureTop). Add a child back, ...\" although product/checkout/pay-by-card.md is still on disk. The reader skipped it for invalid intent (readFolder only keeps nodes readNode returns), so the folder reads as childless. The reader's warning naming the invalid file is in model.warnings, but exportV2Bundle throws before returning them, so `rex export` (cli/commands/export.ts exportV2) never prints it. The operator is told to add a child that is already there, with no pointer to the real cause.\n\nReachable: `rex export` / `ndx prd export` on a hand-edited v2 tree whose folder's only children have invalid intent and whose state.yaml has an extra top-level key. Before dd28f982 the same tree exported (with the warning) a bundle import refused, so this is a worse message, not new data loss.\n\nOptions:\n(a) Recommended. When refusing, append the reader warnings for paths under the stray folder to the error (or say \"has no readable children\" and list skipped files). Cost: pass warnings into the check or catch in exportV2Bundle and enrich. Risk: none.\n(b) Have exportV2Bundle print/return warnings even when build throws (attach them to the BundleError). Cost: small API change. Risk: low."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-09T14:52:34.967Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
