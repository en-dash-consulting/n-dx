---
id: "56e9d8d4-b98e-4377-840f-82337a6568f0"
level: "task"
title: "Re-run judgments: Jev decides what needs re-enrichment and which findings still hold"
status: "pending"
priority: "medium"
tags:
  - "sourcevision"
  - "llm"
  - "typesafe"
blockedBy:
  - "07e84b24-f429-4fc3-940c-a748db0f7878"
source: "ndx-capture"
acceptanceCriteria:
  - "Unit tests with mocked Jev answers: refresh Noul >= 0.7 escalates the zone, <= 0.3 keeps previous insights untouched, 0.3-0.7 keeps them and flags low confidence in the run record"
  - "Unit tests: still-holds Noul >= 0.7 carries a judged finding forward unchanged, <= 0.3 drops it and writes a finding-resolved execution-log entry with the probability, 0.3-0.7 carries it with confidence lowered to the probability; pass 0 and unjudged findings follow the existing hash rule"
  - "Unit test: a zone whose structure and content hashes are unchanged asks no question and makes no request"
  - "Unit test: a re-run on unchanged input makes no generative call and every judgment is a cache hit"
  - "Unit test: a zone needing refresh and an undecided finding in the same scope produce one per-zone narration call whose prompt names the finding to confirm or refute"
  - "manifest.lastAnalysis.rerun is populated with zonesJudged/refreshed/findingsJudged/carried/resolved/uncertain and the CLI prints a [rerun] line"
  - "Live: after editing one file's doc comment in this repository, a cascade re-run is recorded in this item's execution log with the counts above, showing which zones were refreshed and which findings were resolved or carried"
  - "docs/guide/configuration.md gains a 'What a re-run does' subsection under the Jev section"
  - "`pnpm --filter @n-dx/sourcevision test` passes"
description: "Every re-run decision today is mechanical, and blunt in both directions: a zone is re-narrated when its `structureHash` changes (file list), and a previous AI finding is dropped when its zone's content hash changes at all (`isContentStale` in `zones.ts` `assembleFindings`). A comment edit re-narrates nothing but drops every finding in the zone; a real refactor that keeps the file list re-narrates nothing. Jev can judge the delta instead — cheap, cached like every other judgment (`judgment-cache.ts`), and idempotent.\n\n**1. Per changed zone — does the narrative need refreshing?** State: the zone's previous insights and findings, plus the delta since the previous run — files added/removed, files whose leading comment changed (compare `extractFileHeader` output against the previous run's, stored in the run record or recomputed from the previous inventory hashes), crossing deltas in/out, cohesion/coupling deltas. Noul: *does this change alter what a maintainer would say about the zone's purpose, boundaries or risks?* ≥ 0.7 → re-narrate (the zone joins the cascade's escalation set); ≤ 0.3 → keep previous insights untouched; 0.3–0.7 → keep, and mark the zone's insights low-confidence in the run record. The hash stays as a fast pre-filter: an unchanged hash asks no question. On the cascade path this replaces `structureHash`-only gating in `enrich-cascade.ts` / `enrich-per-zone.ts`'s unchanged detection; the `--narrate` path is untouched.\n\n**2. Per previous AI finding — does this still hold?** State: the finding (text, anchors, scope) and the current evidence for its scope (files, headers of the anchor files first, crossings). Noul ≥ 0.7 → carry forward as-is; ≤ 0.3 → drop as resolved, with an `append_log`-style execution-log entry `finding-resolved` carrying the text and probability; 0.3–0.7 → carry forward with `confidence` lowered to the probability. Replaces `isContentStale`'s all-or-nothing drop for pass ≥ 1 findings that carry `confidence` (i.e. were judged); pass 0 findings are recomputed as today; unjudged legacy findings keep the hash rule.\n\n**3. Escalation grouping.** Zones judged as needing refresh and findings judged undecided go into the same per-zone narration call, so one generative call per zone answers both \"what changed here?\" and \"is finding X still true?\" (the prompt gets a short \"previously found, please confirm or refute\" section). This is the chained shape: judge → targeted generation → judge again through the existing verify step.\n\n**4. Run record.** `manifest.lastAnalysis` (and `analyses.jsonl`) gains `rerun: { zonesJudged, refreshed, findingsJudged, carried, resolved, uncertain }`, and the CLI prints one `[rerun]` line.\n\nThresholds in code. Ask both Nouls in one merged request per batch; the zone-delta state is shared so findings reference `zones.<id>` like the verify questions do."
lastModified: "2026-09-22T18:28:01.653Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
