---
id: "62576269-9a7f-4051-8a09-05b7ff914c88"
type: "change"
title: "Write README.proposed.md instead of overwriting an existing README during ndx init"
slug: "write-readme-proposed-md-instead-of"
intent: "When `ndx init` finds an existing README in the target directory, do not modify it. Instead, write the synthesized content to README.proposed.md alongside the original so the user can diff and merge manually. Surface a clear console message pointing to the proposed file."
acceptanceCriteria:
  - "Existing README.md (or any case-insensitive variant) is never read, modified, deleted, or overwritten by ndx init"
  - "When an existing README is detected, the synthesized content is written to README.proposed.md at the repo root"
  - "If README.proposed.md already exists from a previous run, it is overwritten with the latest synthesis (not appended)"
  - "Init console output includes a single line indicating that README.proposed.md was written and pointing users to diff it against the existing README"
  - "When --quiet/JSON output modes are active, the proposed-file path is still reported in the structured output"
touches:
  - "406b4b7a-eab0-45e0-ba4c-b0b9bc9dc9b9"
priority: "high"
tags:
  - "cli"
  - "init"
  - "documentation"
source: "smart-add"
---
