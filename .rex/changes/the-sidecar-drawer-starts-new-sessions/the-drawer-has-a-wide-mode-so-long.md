---
id: "36144c3a-06d2-4516-a4d0-1a8339c3071f"
type: "task"
title: "The drawer has a wide mode so long replies have room"
slug: "the-drawer-has-a-wide-mode-so-long"
description: "The drawer is capped at 640 px (packages/web/src/viewer/components/sidecar-drawer.ts:39, --sidecar-w), and the transcript is squeezed by the agent row, the cards band and the composer; tool results sit behind a click in a 240 px box (styles/sidecar.css:150-156). Add a wide-mode toggle in the drawer head that widens the drawer to most of the viewport (the page behind stays usable at 960 px and up) and lifts the tool-result box's cap; remember the choice per browser (wrap storage in try/catch). Check the top nav still fits with the drawer wide. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "The wide toggle widens the drawer and is remembered (viewer test)"
  - "Narrow viewports keep the drawer usable (viewer test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
