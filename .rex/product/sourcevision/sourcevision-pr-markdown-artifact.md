---
id: "5e38623f-cb68-4916-afd9-31623ab4286b"
type: "capability"
title: "SourceVision PR Markdown Artifact-Based Fallback Mode"
slug: "sourcevision-pr-markdown-artifact"
statement: "When git-based fetch or diff operations fail, SourceVision generates PR markdown from existing analysis artifacts through a deterministic fallback path and labels the output with its mode, coverage and confidence."
criteria: [{"id":"c1","text":"If a git-based fetch or diff operation fails during PR markdown generation, SourceVision shall switch to a deterministic artifact-based fallback path and still produce the PR markdown."},{"id":"c2","text":"When PR markdown is produced in fallback mode, SourceVision shall label the output as fallback output."},{"id":"c3","text":"When PR markdown is produced in fallback mode, SourceVision shall attach measurable coverage and confidence signals to the output."}]
source: "smart-add"
---
