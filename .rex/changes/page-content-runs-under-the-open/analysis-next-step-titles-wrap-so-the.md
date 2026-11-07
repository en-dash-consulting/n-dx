---
id: "2aea5018-9b76-454e-af29-e64abc6d516d"
type: "task"
title: "Analysis next-step titles wrap so the copy button stays in the row"
slug: "analysis-next-step-titles-wrap-so-the"
description: "Operator browser check (2026-11-06): on /analyze with the Sidecar drawer open (#main-content 584 px at a 1024 px viewport, 1000 px at 1440 px), the embedded next-steps list in its stage tile has rows (.next-step-row, display: flex, about 214 px wide) whose .next-step-title (flex: 1, min-width: auto) holds a long unbreakable file path (e.g. 'Fan-in hotspot: packages/web/src/viewer/hooks/index.ts …'). The title cannot shrink below the path's width (about 251 px), so it overflows the row and pushes .next-step-copy (the 28 px copy button) out to 644-672 px, past the tile's 571 px edge, where the tile body's overflow: hidden clips it. Fix in packages/web/src/viewer/styles/overview.css: min-width: 0 and overflow-wrap: anywhere on .next-step-title (a path has no spaces to break at), and flex-shrink: 0 on .next-step-copy so the button keeps its size inside the row. Check .next-step-desc and the other next-step row children for the same pattern. Operator notes: you cannot measure layout in this run; the operator re-measures in a real browser afterwards. Style only with tokens from packages/web/src/viewer/styles/tokens.css and keep both themes. Do not touch the Sidecar drawer's open/close logic, .n-dx.json, packages/web/AGENTS.md or src/server/AGENTS.md. Test the rule the way tests/unit/viewer/stage-tile-tree-fill.test.ts does (read the stylesheet and assert the declaration on the selector). Run the touched viewer tests and the static root policy suites before finishing; add a @n-dx/web patch changeset."
acceptanceCriteria:
  - ".next-step-title has min-width: 0 and wraps long paths; .next-step-copy does not shrink (stylesheet test)"
  - "On /analyze with the drawer open at 1024 px and 1440 px, every .next-step-copy button is inside its row (operator browser check)"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
