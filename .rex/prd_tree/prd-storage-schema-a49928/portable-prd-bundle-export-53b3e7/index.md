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
| [buildBundle stamps the exporter's SCHEMA_VERSION instead of the document's schema](./buildbundle-stamps-the-exporter-e3e849.md) | completed |
| [Bundle import skips validateDAG and LEVEL_HIERARCHY — cycles and illegal placement reach the tree](./bundle-import-skips-validatedag-0aea07.md) | completed |
| [Bundle-imported item with `lastModifiedBy` but no `lastModified` is never pushed by remote sync](./bundle-imported-item-with-b9a269.md) | completed |
| [Bundles transport the source project's lastSyncedAt/remoteId, corrupting the destination's remote sync](./bundles-transport-the-source-134b97.md) | completed |
| [Business-owner narrative Markdown PRD export](./business-owner-narrative-603781.md) | completed |
| [`defaultTimestampFromExport` is now redundant and writes an unvalidated `exportedAt` to disk](./defaulttimestampfromexport-is-5d5e3e.md) | completed |
| [Export in-tree guard stops one directory short of the legacy PRD backend paths](./export-in-tree-guard-stops-one-497fb6.md) | completed |
| [`import-bundle --replace` clears the destination's own `remoteId` and `lastSyncedAt`](./import-bundle-replace-clears-8755e7.md) | completed |
| [`import-bundle --replace` rewrites the tree with no snapshot, no archive batch](./import-bundle-replace-rewrites-1d9197.md) | completed |
| [import-bundle writes no execution-log entry — the only PRD-mutating command that leaves no trace](./import-bundle-writes-no-3b63c3.md) | completed |
| [Narrative export of an empty PRD claims "everything on the plan is finished"](./narrative-export-of-an-empty-15a698.md) | completed |
| [`ndx prd` dispatch has no functional test coverage](./ndx-prd-dispatch-has-no-3e512e.md) | completed |
| [`ndx prd export --out <path>` (space form) drops the value and misroutes the export](./ndx-prd-export-out-path-space-7445cf.md) | completed |
| [`parseBundle` accepts duplicate item ids; `--replace` writes them into the tree](./parsebundle-accepts-duplicate-68ee06.md) | completed |
| [--replace confirmation prompt undercounts the items it is about to destroy](./replace-confirmation-prompt-af48d8.md) | completed |
| [`rex export` reads the PRD tree without the lock, so a concurrent writer can yield a torn bundle](./rex-export-reads-the-prd-tree-315710.md) | completed |
| [Round-trip PRD bundle via ndx prd export / ndx prd import](./round-trip-prd-bundle-via-ndx-0ef8ca.md) | completed |
| [Scoped bundle export by item — subtree and dependency closure](./scoped-bundle-export-by-item-b00afc.md) | completed |
| [stableKey collision comparison counts sync bookkeeping as content, steering operators toward --replace](./stablekey-collision-comparison-4412d3.md) | completed |
| [`stampChangedItems` attribution-only widening changes the rule for every `withTransaction` caller](./stampchangeditems-attribution-8686d4.md) | completed |
| [`stampChangedItems` tests `!== undefined` but its consumer tests truthiness, so `lastModified: null` defeats the repair](./stampchangeditems-tests-284a3e.md) | completed |
| [The folder tree persists no schema marker, so a newer-minor writer leaves no trace](./the-folder-tree-persists-no-ac6f56.md) | completed |
