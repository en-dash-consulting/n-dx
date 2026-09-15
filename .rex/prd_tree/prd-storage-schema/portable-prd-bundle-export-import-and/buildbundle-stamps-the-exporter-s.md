---
id: "e3e84949-2e0d-4f1f-9de4-a34a9aa2002f"
level: "task"
title: "buildBundle stamps the exporter's SCHEMA_VERSION instead of the document's schema"
status: "completed"
priority: "medium"
tags:
  - "pr-review"
  - "severity:medium"
source: "pr-review"
startedAt: "2026-09-10T19:56:21.783Z"
completedAt: "2026-09-10T20:00:49.830Z"
endedAt: "2026-09-10T20:00:49.830Z"
resolutionType: "code-change"
resolutionDetail: "buildBundle stamps `doc.schema ?? SCHEMA_VERSION`, so a newer-minor document exports a bundle labelled with its own minor and parseBundle's gate refuses it instead of comparing equal minors and admitting unvalidated passthrough fields. Three tests: the document's version is stamped, an absent schema falls back to the running version, and a newer-minor bundle is refused end to end through a JSON round trip. The pre-existing envelope test was renamed — its fixture sits at the running version, so its schema assertion could not distinguish the two implementations. Follow-up captured as ac6f568b (tree persists no schema marker). Full suite clean, 6/6."
acceptanceCriteria:
  - "buildBundle stamps doc.schema, falling back to SCHEMA_VERSION when absent"
  - "Unit test: a doc with schema rex/v1.1 exports a bundle labelled rex/v1.1, and parseBundle on a v1-running rex rejects it as newer"
description: "Verdict: valid, with narrower exposure than the review states. buildBundle (packages/rex/src/core/prd-bundle.ts:100) writes `schema: SCHEMA_VERSION` rather than `doc.schema`. A document loaded from a newer-minor source (isCompatibleSchema admits newer minors, and passthrough keeps their fields) is relabelled downward, so parseBundle's minor-version gate (bundleSchema.minor > runningSchema.minor) never fires and unrecognised fields land in the tree unvalidated — exactly what the module docblock says the gate prevents.\n\nCaveat found during verification: for tree-backed loads, FileStore.loadDocument hardcodes `schema: SCHEMA_VERSION` (store/file-adapter.ts:443), so doc.schema is always the running version there and the tree itself persists no schema marker (tree-meta.json stores title only). The downward-relabel scenario is reachable only via legacy backends (prd.md / prd.json loads preserve the file's schema string, file-adapter.ts:233). The fix is still correct and one line.\n\nSolution: `schema: doc.schema ?? SCHEMA_VERSION` in buildBundle. Consider a follow-up (out of scope for this branch): persist a schema version in tree-meta.json so newer-minor tree writers leave a marker at all."
lastModified: "2026-09-10T20:00:49.836Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
