---
id: "ae021f60-89b4-420e-970f-fdad584f9405"
type: "task"
title: "Declare the analysis files and the readiness JSON as a surface in public-surface.md"
slug: "declare-the-analysis-files-and-the"
summary: "Write down which analysis files other tools may rely on, what their version label means, and how stable they are."
description: "Add an \"Analysis files\" row to the Declared surfaces table in docs/architecture/public-surface.md, with a short section: which files under the sourcevision analysis directory are covered (the fact files from data-files.ts, manifest.json, and `sv readiness --json` output), what schemaVersion means (a reader may rely on every field of a version; a breaking change bumps it and needs a release-note entry), how a reader should treat an unknown version, that `ecosystem` is keyed by pack id in lower case while inventory.json names languages, and the meaning of manifest.packs and parseIssues. Mark the status the owner chooses (soft-frozen like the other surfaces, or experimental until promoted); if no decision is recorded on the change when this runs, use experimental and say so in the run summary. Mirror the row in the docs index if one lists surfaces. Leave callgraph.json and zone files out unless the owner says otherwise."
acceptanceCriteria:
  - "public-surface.md has an Analysis files row naming the covered files and their status"
  - "The section states the schemaVersion rule, the ecosystem key convention, and the meaning of manifest.packs and parseIssues"
  - "callgraph.json is explicitly outside the declared surface"
  - "Docs build (VitePress) passes with the new section"
priority: "medium"
tags:
  - "docs"
  - "public-surface"
  - "sourcevision"
source: "ndx-capture"
blockedBy:
  - "7f4713b1-ab9e-4b67-bf59-19b5aa16284a"
  - "6535016a-5b36-4c8a-a518-785882ab9263"
  - "90605ac0-4321-4bc1-b0de-85f3935daa39"
---
