---
id: "523668ec-59f0-4091-a891-9121f7077415"
level: "task"
title: "Cascade re-run idempotence: no repeated name fallbacks, unchanged escalated zones carried forward, stable judgment keys, naming progress"
status: "in_progress"
priority: "high"
tags:
  - "sourcevision"
  - "llm"
  - "typesafe"
source: "ndx-capture"
startedAt: "2026-09-22T12:45:17.912Z"
acceptanceCriteria:
  - "Unit test: a zone whose previous match has the same file set and an algorithmic name gets no generated-name fallback; a zone with a changed file set does"
  - "Unit test: an escalated zone whose previous match overlaps >= 0.9 and has insights is not narrated and keeps those insights; one below the overlap or without insights is narrated"
  - "Unit test: fragility, finding-evidence and move request state contain no zone name or description, and judgmentKey is unchanged when only a zone's name changes"
  - "Unit test: generated-name fallbacks run in bounded concurrent chunks and each emits a progress line; the naming batch emits one"
  - "Live: a second `sv analyze .` on the same keyed repository with no changes records zero zone.enrich-scan and zone.enrich-deep calls and completes in under 30 s; recorded in this item's log with the manifest.lastAnalysis numbers"
  - "pnpm --filter @n-dx/sourcevision test passes; prompt-text-identity snapshots unchanged"
description: "A no-change re-run of `sv analyze` on a keyed repository with 17 zone pins took 277 s (manifest.lastAnalysis, 2026-09-22): `zone.enrich-scan` 13 calls / 195 s (generated-name fallbacks, one sequential Claude spawn each), `zone.enrich-deep` 6 calls / 132 s (the same six escalated zones re-narrated), `zone.judge` 16 calls / 6 s, judgment cache 54 hits / 280 misses. Nothing about the repository had changed. Three idempotence defects in `enrich-cascade.ts` / `zone-naming.ts` / `enrich-judge.ts`:\n\n1. **Repeated name fallbacks.** A zone whose Choice comes back `none` (or under 0.5) and whose generated names then fail the describes-Noul keeps its algorithmic name — and nothing records that, so the next run re-selects, gets `none` again, and spends the text-model calls again. Fix: when the previous run's matching zone has the *same file set* and still carries the algorithmic name, skip the generated-name fallback for it (the Jev Choice still runs; it is cached). New files in the zone re-enable the fallback.\n\n2. **Escalated zones re-narrated.** The cascade names and judges zones before `applyZonePins` moves files, but the previous run's zones are stored after pins, so the synthetic previous's structure hashes never match and \"N zones to enrich (0 unchanged)\" is printed every run. Fix: an escalated zone whose previous match overlaps ≥ 0.9 by files and has insights is treated as unchanged — insights and token usage carried forward, no narration; log how many were carried.\n\n3. **Unstable judgment keys.** `name` (and the templated `description`, which embeds partner zone names) sit inside the judged state for fragility, finding evidence and moves; names differ between runs, so cache keys differ. Remove `name`/`description` from judged state — the file list, metrics and imports are the evidence — so a no-change run is cache hits.\n\n4. **Naming progress.** `nameZonesBySelection` prints nothing until it finishes and runs fallbacks one at a time; print a line per Jev batch and per fallback and run fallbacks with bounded concurrency (3, matching per-zone narration). This overlaps deferred item fa5c117f's point 5; it lands here because it is what makes the re-run look hung.\n\nAcceptance is a no-change re-run on that repository taking seconds: Jev cache hits, zero text-model calls."
lastModified: "2026-09-22T12:45:17.923Z"
lastModifiedBy: "Nick Daniel <nick@endash.us>"
---
