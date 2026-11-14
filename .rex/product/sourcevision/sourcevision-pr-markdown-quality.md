---
id: "1c8695a6-c31f-4411-8db6-4ba115776617"
type: "capability"
title: "SourceVision PR Markdown Quality & Manual Refresh"
slug: "sourcevision-pr-markdown-quality"
statement: "SourceVision generates reviewer-focused PR markdown and regenerates it only when the user asks."
criteria: [{"id":"c1","text":"SourceVision shall build generated PR summaries around what a reviewer needs to see, not a full file-by-file listing."},{"id":"c2","text":"SourceVision shall regenerate PR markdown only when the user runs a command that generates it (`sv pr-markdown`, the PR markdown step of `sv analyze`, or `ndx refresh --pr-markdown`), and never refresh it on its own."},{"id":"c3","text":"`sv pr-markdown` shall write the generated PR markdown to `.sourcevision/pr-markdown.md`."},{"id":"c5","text":"If the PRD cannot be read, the directory is not a git repository, or the base branch cannot be resolved, `sv pr-markdown` shall still write the markdown and report the gap as a warning rather than fail."}]
source: "smart-add"
---

## History

- 2026-11-12 e782039b-f010-45b8-bae3-868d36283243 modified: PR markdown is no longer shown in a dashboard tab
- 2026-11-13 editorial: Criteria follow the dashboard PR tab's retirement (e782039b): the tab, freshness and refresh-endpoint criteria are removed, and the rest describe the CLI generator that stays
