---
id: "dbf09180-abc8-4226-addf-80b427fe3943"
level: "task"
title: "Generate target-repo README.md from project summary when no README exists during ndx init"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "init"
  - "documentation"
source: "smart-add"
startedAt: "2026-06-01T15:12:35.342Z"
completedAt: "2026-06-01T15:19:50.900Z"
endedAt: "2026-06-01T15:19:50.900Z"
resolutionType: "code-change"
resolutionDetail: "Added readme-generator module, hooked into both static and Ink init paths. One target test green; remaining five belong to sibling proposed-file task."
acceptanceCriteria:
  - "ndx init detects absence of README.md and common variants (README, README.rst, README.txt, readme.md) in the target dir before writing"
  - "Generated README.md derives project name and description from the target project's manifest (package.json name/description, go.mod module, etc.), not from n-dx's own README"
  - "Generated README.md includes at minimum: project title, one-paragraph summary, and a top-level structure or scripts overview"
  - "When no manifest is present, falls back to directory-name-based title and a structure-only summary without n-dx-specific language"
  - "No README is written if any case-insensitive README variant already exists in the target dir"
description: "During `ndx init`, when the target directory has no README, synthesize a basic README.md from the target project's own metadata (package.json/go.mod/pyproject, top-level directory structure, detected languages, entry points). The content must describe the user's repo, not the n-dx toolkit. Reuse the existing sourcevision summary pipeline as the data source so the README reflects the actual codebase being initialized."
---
