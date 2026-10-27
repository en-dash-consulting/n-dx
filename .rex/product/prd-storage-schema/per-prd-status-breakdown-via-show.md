---
id: "73fc1ee2-42b8-4be6-b743-c269308f0868"
type: "capability"
title: "Per-PRD Status Breakdown via --show-individual"
slug: "per-prd-status-breakdown-via-show"
statement: "The `ndx status` and `rex status` commands accept a `--show-individual` flag that breaks status down by source PRD file. The canonical `.rex/prd.md` and any branch-scoped PRD files each get their own section in human-readable output, and their own element in JSON output."
criteria: [{"id":"c1","text":"When `ndx status` runs with `--show-individual`, the status command shall print one labeled section per PRD file, covering the canonical `.rex/prd.md` and any branch-scoped `.rex/prd_{branch}_{date}.md` file."},{"id":"c2","text":"When `--show-individual` is given, the status command shall show in each section the PRD file path and that file's completion stats: total, completed and pending counts."},{"id":"c3","text":"When `--show-individual` is given, the status command shall use existing branch and source-file metadata to attribute each item to its source PRD file, and shall place each item in exactly one section."},{"id":"c4","text":"When `--show-individual` is combined with `--format=json`, the status command shall emit an array whose elements each have `prdPath`, `stats` and `items` fields."},{"id":"c5","text":"When `--show-individual` is given and only one PRD file exists, the status command shall produce a single section without error."},{"id":"c6","text":"The `ndx status` help text shall document the `--show-individual` flag with a brief usage example."}]
source: "smart-add"
---

Add a --show-individual flag to ndx status so users can see status broken down per PRD file when multiple branch-scoped PRD files exist alongside the canonical prd.md.
