---
id: "134b979c-eb41-42c2-b494-6ef795056b95"
level: "task"
title: "Bundles transport the source project's lastSyncedAt/remoteId, corrupting the destination's remote sync"
status: "completed"
priority: "high"
tags:
  - "pr-review"
  - "severity:high"
source: "pr-review"
startedAt: "2026-09-10T19:27:40.242Z"
completedAt: "2026-09-10T19:46:10.690Z"
endedAt: "2026-09-10T19:46:10.690Z"
resolutionType: "code-change"
resolutionDetail: "Already implemented by commit d834ab86 but left in_progress when that machine was interrupted; verified against all three acceptance criteria before closing. buildBundle deep-clones the items and calls stripSyncBookkeeping, which recursively deletes BUNDLE_STRIPPED_FIELDS (lastSyncedAt, remoteId) across the whole tree; prd-bundle.test.ts asserts the strip, that lastModified/lastModifiedBy survive it, that the source document is not mutated, and that a defaulted item reads as never-synced local work. Status corrected from this machine, not re-implemented. Note: d834ab86 shipped no changeset — tracked separately."
acceptanceCriteria:
  - "buildBundle strips lastSyncedAt and remoteId from every item (recursively) on export"
  - "lastModified and lastModifiedBy are preserved in the bundle"
  - "Test: export a synced tree, assert no item in the bundle carries lastSyncedAt or remoteId; import into a fresh project and assert isModifiedSinceSync treats the items as pushable"
description: "Verdict: valid (verified). buildBundle clones doc.items verbatim (core/prd-bundle.ts:104) and nothing on the export or import path strips lastSyncedAt or remoteId, which sync.ts declares non-content in both SYNC_META_FIELDS and SIGNATURE_IGNORED.\n\nFailure scenario: export from project A (synced to A's Notion workspace), import into project B. Items arrive with A's lastSyncedAt at/after their lastModified, so isModifiedSinceSync returns false and B's first bidirectional sync lets the remote win — overwriting the freshly imported content. The stale remoteId values also point at A's pages, so B's sync writes into another project's remote records.\n\nSolution nuance (important — differs from the reviewer's literal suggestion): strip only lastSyncedAt and remoteId on export, NOT all of SYNC_META_FIELDS. lastModified/lastModifiedBy are content attribution this branch deliberately preserves (see defaultTimestampFromExport, commit d34aa4f0) — stripping them would reopen the attribution-only-item trap that fix closed. Provenance belongs in exportedFrom, not in per-item remote pointers."
lastModified: "2026-09-10T19:46:10.696Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---
