---
id: "f4a20101-bc2a-4478-9ba0-3013c6e93177"
type: "capability"
title: "Live PR Markdown in SourceVision UI"
slug: "live-pr-markdown-in-sourcevision-ui"
statement: "The SourceVision UI shows a dedicated tab on localhost that presents a markdown PR summary of the current branch's changes against main, keeps it current as repository state changes, and fails safely when git context is unavailable."
criteria: [{"id":"c1","text":"The PR summary generator shall produce a markdown PR summary from the current branch's changes against main."},{"id":"c2","text":"The PR summary generator shall include the base reference metadata in the generated markdown."},{"id":"c3","text":"The SourceVision UI shall provide a dedicated tab on localhost that presents the latest PR markdown."},{"id":"c4","text":"The PR markdown tab shall let the user copy the PR markdown for pasting elsewhere."},{"id":"c5","text":"When repository state changes, the SourceVision UI shall refresh the PR markdown to match the current state."},{"id":"c6","text":"If git context is unavailable, the SourceVision UI shall fail safely instead of presenting a broken PR summary."}]
source: "smart-add"
---
