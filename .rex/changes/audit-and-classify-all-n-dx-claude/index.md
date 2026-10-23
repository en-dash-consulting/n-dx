---
id: "62fafbbb-2583-4c1d-acc5-e7a63d89764d"
type: "change"
title: "Audit and classify all n-dx Claude Code skills by mutation footprint"
slug: "audit-and-classify-all-n-dx-claude"
intent: "Review all skill definition files (under packages/core/assistant-assets/ or .claude/skills/) and classify each skill as read-only or file-modifying. For file-modifying skills, note whether they already produce a commit as their final step and whether they are ever invoked inside the hench agent run loop. Produce a concise classification table that will drive the implementation task and serve as a reference for future skill authors."
acceptanceCriteria:
  - "Every skill file is enumerated and labeled as read-only or file-modifying"
  - "File-modifying skills are further annotated: already commits / does not commit"
  - "Any skill invoked as part of the hench agent run loop is explicitly flagged as out-of-scope"
  - "Classification is stored in a discoverable location (inline comment, SKILLS.md, or similar) for future contributors"
touches:
  - "efac37e0-dc05-4140-b0e1-dfb3e24b6f7e"
priority: "high"
tags:
  - "skills"
  - "claude-code"
  - "commit"
  - "audit"
source: "smart-add"
---
