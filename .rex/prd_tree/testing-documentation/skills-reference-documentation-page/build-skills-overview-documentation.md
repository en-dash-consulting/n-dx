---
id: "5494682d-ad4b-41cc-8b59-59fa7b7e47f4"
level: "task"
title: "Build skills overview documentation page with per-skill descriptions and customization guidance"
status: "completed"
priority: "high"
tags:
  - "documentation"
  - "skills"
source: "smart-add"
startedAt: "2026-05-18T12:53:49.021Z"
completedAt: "2026-05-18T12:56:09.007Z"
endedAt: "2026-05-18T12:56:09.007Z"
resolutionType: "code-change"
resolutionDetail: "Created docs/guide/skills.md enumerating all 9 manifest skills with name, purpose, trigger, and customization notes; added sidebar entry to VitePress config."
acceptanceCriteria:
  - "A skills overview page exists and lists every skill currently registered in packages/core/assistant-assets/"
  - "Each skill entry includes name, one-line purpose, trigger condition, and a customization/extension note"
  - "Page includes a section explaining how to add or override a skill in a user's project"
  - "Page renders correctly in both the web dashboard (if applicable) and as standalone markdown"
  - "Skill inventory is generated or verified against the assistant-assets manifest (no hand-maintained drift)"
description: "Author a single canonical documentation page (e.g. docs/skills.md or a dashboard route) that enumerates every skill shipped with ndx, including each skill's name, purpose, when it triggers, what it does, and how a user can customize or replace it. Source the skill inventory from the existing manifest under packages/core/assistant-assets/ so the page stays in sync with the actual skill set. Include a 'Adding your own skill' section explaining the file layout and registration steps."
---
