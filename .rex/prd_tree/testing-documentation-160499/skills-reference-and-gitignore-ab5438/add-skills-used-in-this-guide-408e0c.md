---
id: "408e0c6e-865f-48aa-ad01-68e30f17a06d"
level: "task"
title: "Add 'Skills used in this guide' sections to ndx workflow documentation"
status: "pending"
priority: "medium"
tags:
  - "documentation"
  - "skills"
  - "ux"
source: "smart-add"
acceptanceCriteria:
  - "Every workflow guide under docs/ (or wherever the guides live) includes a 'Skills used in this guide' section"
  - "Each listed skill links to its source file location relative to the repository root"
  - "The skill list covers the full execution path of the guide, not only the entry command"
  - "A short intro sentence explains that users can edit the linked skill files to customize behavior"
  - "Documentation passes existing docs/link-check (or equivalent) without broken references"
description: "Audit every ndx workflow/use-case guide (e.g. Spec-Driven Development, Codebase Onboarding, Run While You Sleep, Vibe-Coded App Cleanup, Ongoing Change Management) and append a 'Skills used in this guide' section that lists each skill invoked along that document's end-to-end path, with relative links to the skill source files so users can locate and modify them. Trace the full path a user follows through the guide — not just the top-level command — and include downstream skills that are triggered indirectly. Cross-link related guides where they share skills."
---
