---
id: "5e3017b6-7598-4ea5-9ab6-da30ef90cede"
type: "task"
title: "Sidecar replies render Markdown through one shared, vnode-based renderer"
slug: "sidecar-replies-render-markdown"
description: "Assistant text is a raw pre-wrap text child (packages/web/src/viewer/components/sidecar-drawer.ts:212), so Markdown prints as plain text; the hub drawer reuses the same row. A safe renderer exists but is private and block-only: renderMarkdownPreview in viewer/views/pr-markdown.ts:100-185 (headings, fenced code, lists, paragraphs, built as Preact vnodes, no innerHTML). Move it to a shared viewer utility, export it through the right barrel, add an inline pass (inline code, bold, italic, links that open in a new tab with rel=noopener; no raw HTML ever), keep pr-markdown on it, and render Sidecar assistant text with it. Streaming partial text must not flicker into broken markup (render what is complete). Style with tokens only. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "Headings, lists, fenced and inline code, bold and links render in a Sidecar reply (viewer test)"
  - "Raw HTML in a reply renders as text (viewer test)"
  - "The PR preview still renders as before (viewer test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
