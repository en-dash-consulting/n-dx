---
id: "1c8695a6-c31f-4411-8db6-4ba115776617"
type: "capability"
title: "SourceVision PR Markdown Quality & Manual Refresh"
slug: "sourcevision-pr-markdown-quality"
statement: "SourceVision generates reviewer-focused PR markdown, regenerates it only when the user asks, and shows the cached copy in the PR tab with messages about freshness and failures."
criteria: [{"id":"c1","text":"SourceVision shall build generated PR summaries around what a reviewer needs to see, not a full file-by-file listing."},{"id":"c2","text":"SourceVision shall regenerate PR markdown only when the user starts a refresh from the CLI or a UI action, and never refresh it automatically."},{"id":"c3","text":"When cached PR markdown exists, the SourceVision PR tab shall display it."},{"id":"c4","text":"The SourceVision PR tab shall show a message saying how fresh the displayed PR markdown is."},{"id":"c5","text":"If PR markdown generation fails, the SourceVision PR tab shall show a message describing the failure."},{"id":"c6","text":"If refresh prerequisites fail while cached markdown is available, the `/api/sv/pr-markdown/refresh` endpoint shall return a structured degraded response, in the same way as the read and state endpoints."},{"id":"c7","text":"When a refresh returns a degraded response, the SourceVision PR tab shall show a message naming the specific cause and keep the cached markdown available."}]
source: "smart-add"
---
