---
id: "53b3e7da-f618-404b-a69d-d7768fe9546f"
level: "feature"
title: "Portable PRD Bundle — Export, Import, and Narrative Rendering"
status: "completed"
priority: "medium"
tags:
  - "prd"
  - "portability"
  - "cli"
  - "export"
source: "ndx-capture"
startedAt: "2026-09-09T14:08:48.916Z"
completedAt: "2026-09-11T22:30:40.854Z"
endedAt: "2026-09-11T22:30:40.854Z"
acceptanceCriteria:
  - "`ndx prd export` and `ndx prd import` exist as an orchestrator subcommand group, spawning rex CLI commands per the spawn-only orchestration rule; `ndx export` behaviour is unchanged"
  - "The bundle JSON is written only to a user-specified output path outside `.rex/prd_tree/`, and no PRD mutation path reads or writes it as a backend"
  - "A carve-out note is added to the PRD-invariant documentation explaining why the bundle is JSON despite the markdown-only write-path rule"
  - "Documentation (README command reference and `ndx prd --help`) distinguishes the bundle exporter from the dashboard exporter so the two commands are not confused"
description: "A single-file PRD bundle that captures every item in `.rex/prd_tree/` — ids, hierarchy, status, acceptance criteria, tags, dependencies, and metadata — so a PRD can be carried between machines without sharing the repo or configuring a remote adapter (`rex sync`). Surfaced as a new `ndx prd` subcommand group (`ndx prd export` / `ndx prd import`) backed by rex CLI commands; `ndx export` remains the static-dashboard exporter (`packages/core/export.js`) and is not changed.\n\nThe bundle is a single JSON file. This requires an explicit carve-out from the markdown-only rule established by the completed feature \"JSON Write Path Removal and Markdown-Only Enforcement\" (21a86676-166a-4af7-bc57-39af1f47d2ba): the bundle is a *transport artifact* written to a user-chosen path outside `.rex/prd_tree/`, never read as a PRD backend and never a write target for PRD mutations. The PRD invariant — the folder tree is the sole writable PRD surface — is unchanged; import reconstructs the folder tree through the normal store write path.\n\nAlongside the machine round-trip, a narrative rendering mode emits prose Markdown suitable for a stakeholder doc — the PRD as a business owner would write it, with no ids, slugs, or internal status codes."
lastModified: "2026-09-11T22:30:40.877Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [buildBundle stamps the exporter's SCHEMA_VERSION instead of the document's schema](./buildbundle-stamps-the-exporter-s.md) | completed |
| [Bundle import skips validateDAG and LEVEL_HIERARCHY — cycles and illegal placement reach the tree](./bundle-import-skips-validatedag-and.md) | completed |
| [Bundle-imported item with `lastModifiedBy` but no `lastModified` is never pushed by remote sync](./bundle-imported-item-with.md) | completed |
| [Bundles transport the source project's lastSyncedAt/remoteId, corrupting the destination's remote sync](./bundles-transport-the-source-project-s.md) | completed |
| [Business-owner narrative Markdown PRD export](./business-owner-narrative-markdown-prd.md) | completed |
| [`defaultTimestampFromExport` is now redundant and writes an unvalidated `exportedAt` to disk](./defaulttimestampfromexport-is-now.md) | completed |
| [Export in-tree guard stops one directory short of the legacy PRD backend paths](./export-in-tree-guard-stops-one.md) | completed |
| [`import-bundle --replace` clears the destination's own `remoteId` and `lastSyncedAt`](./import-bundle-replace-clears-the.md) | completed |
| [`import-bundle --replace` rewrites the tree with no snapshot, no archive batch](./import-bundle-replace-rewrites-the.md) | completed |
| [import-bundle writes no execution-log entry — the only PRD-mutating command that leaves no trace](./import-bundle-writes-no-execution-log.md) | completed |
| [Narrative export of an empty PRD claims "everything on the plan is finished"](./narrative-export-of-an-empty-prd.md) | completed |
| [`ndx prd` dispatch has no functional test coverage](./ndx-prd-dispatch-has-no-functional.md) | completed |
| [`ndx prd export --out <path>` (space form) drops the value and misroutes the export](./ndx-prd-export-out-path-space-form.md) | completed |
| [`parseBundle` accepts duplicate item ids; `--replace` writes them into the tree](./parsebundle-accepts-duplicate-item-ids.md) | completed |
| [--replace confirmation prompt undercounts the items it is about to destroy](./replace-confirmation-prompt.md) | completed |
| [`rex export` reads the PRD tree without the lock, so a concurrent writer can yield a torn bundle](./rex-export-reads-the-prd-tree-without.md) | completed |
| [Round-trip PRD bundle via ndx prd export / ndx prd import](./round-trip-prd-bundle-via-ndx-prd.md) | completed |
| [Scoped bundle export by item — subtree and dependency closure](./scoped-bundle-export-by-item-subtree.md) | completed |
| [stableKey collision comparison counts sync bookkeeping as content, steering operators toward --replace](./stablekey-collision-comparison-counts.md) | completed |
| [`stampChangedItems` attribution-only widening changes the rule for every `withTransaction` caller](./stampchangeditems-attribution-only.md) | completed |
| [`stampChangedItems` tests `!== undefined` but its consumer tests truthiness, so `lastModified: null` defeats the repair](./stampchangeditems-tests-undefined-but.md) | completed |
| [The folder tree persists no schema marker, so a newer-minor writer leaves no trace](./the-folder-tree-persists-no-schema.md) | completed |
