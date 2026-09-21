---
id: "2e6f0a74-f49b-4bd6-92ab-088db5568c58"
level: "task"
title: "Add PRD structure diagram placeholder with 'img_here' label"
status: "completed"
priority: "medium"
tags:
  - "documentation"
  - "diagram"
source: "smart-add"
startedAt: "2026-04-23T03:09:12.193Z"
completedAt: "2026-04-23T03:10:36.889Z"
resolutionType: "code-change"
resolutionDetail: "Added markdown image-syntax placeholders with the literal label 'img_here' plus descriptive captions in two primary doc locations: root README.md (after the §Output Files legacy PRD migration note) and packages/rex/README.md (in the §PRD file layout subsection). Captions describe the intended diagram — the legacy branch-scoped multi-file layout (prd_{branch}_{date}.json) and its consolidation into the single canonical .rex/prd.json with sources renamed to .backup.<timestamp> on first load. The image syntax `![img_here](img_here)` is trivially find-and-replaceable when the real image is produced."
acceptanceCriteria:
  - "A placeholder block with the literal text 'img_here' is present in the PRD-structure documentation section"
  - "The placeholder is accompanied by a caption or surrounding text describing the intended diagram content"
  - "The placeholder appears in at minimum one primary doc location where readers first encounter the PRD structure"
  - "The placeholder uses a markdown-friendly format (e.g. image syntax or clearly marked block) that renders cleanly and is easy to find-and-replace"
description: "Insert a reserved placeholder for a diagram of the new PRD structure in the primary documentation location (README.md and/or CLAUDE.md where the PRD format is first introduced) using the literal label 'img_here' so the user can replace it with the actual image later. Include a short caption describing what the diagram should depict (branch-scoped multi-file layout and their relationships) so the replacement image has clear intent."
---
