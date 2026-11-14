---
id: "e782039b-f010-45b8-bae3-868d36283243"
type: "change"
title: "Remove the PR Markdown dashboard page and its sourcevision.prMarkdown toggle"
slug: "remove-the-pr-markdown-dashboard-page"
intent: "Decided on 2026-11-12 in the feature-flag audit: delete the SourceVision PR Markdown dashboard page and its toggle rather than promote it. The page has been off by default and unchanged since 2026-04-28 (907c5fe8a).\n\nRemove the view (packages/web/src/viewer/views/pr-markdown.ts, styles/pr-markdown.css), its stage section (the featureGate entry in views/stages.ts and the toggle read in views/stage-pages.ts), its view id, routing, meta and registry entries (shared/view-id.ts, shared/view-routing.ts, views/view-meta.ts, views/view-registry.ts, route-state.ts, domain-sourcevision.ts), the guide, FAQ and favicon mentions, the two read routes /api/sv/pr-markdown and /api/sv/pr-markdown/state in server/routes-sourcevision.ts (with server/pr-markdown-refresh-diagnostics.ts if nothing else uses it), its ROUTE_FEATURE_GATES row in server/route-feature-gates.ts, and the sourcevision.prMarkdown entry in FEATURE_REGISTRY. views/ask.ts and the ask stylesheets reference pr-markdown: keep the Ask page working. Update packages/web/AGENTS.md, which names prMarkdown as its example of a toggle with no server gate.\n\nOut of scope: the generator stays. `sv pr-markdown`, the PR markdown step of `sv analyze` and the PR markdown cache that `ndx refresh` rebuilds are unchanged."
acceptanceCriteria:
  - "The dashboard has no PR Markdown page, nav entry or stage section, and sourcevision.prMarkdown is in neither FEATURE_REGISTRY nor ROUTE_FEATURE_GATES"
  - "/api/sv/pr-markdown and /api/sv/pr-markdown/state answer 404"
  - "An old URL or saved route for the PR Markdown view opens a working SourceVision page, not an error"
  - "`sv pr-markdown`, the PR markdown step of `sv analyze` and `ndx refresh`'s PR markdown cache still work"
  - "The Ask page renders and behaves as before"
  - "A patch changeset for @n-dx/web"
amends: [{"target":"f4a20101-bc2a-4478-9ba0-3013c6e93177","delta":"removed","summary":"The dashboard's PR Markdown tab is removed"},{"target":"b59bc8e6-e00d-48cf-a932-2516d126ca4e","delta":"removed","summary":"The PR Markdown view and its toggle and copy controls are removed with the page"},{"target":"1c8695a6-c31f-4411-8db6-4ba115776617","delta":"modified","summary":"PR markdown is no longer shown in a dashboard tab","proposed":"SourceVision generates reviewer-focused PR markdown and regenerates it only when the user asks."}]
priority: "medium"
tags:
  - "feature-flags"
  - "web"
  - "sourcevision"
source: "ndx-capture"
---
