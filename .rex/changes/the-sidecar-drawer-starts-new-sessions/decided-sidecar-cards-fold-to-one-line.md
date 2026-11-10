---
id: "3711844c-d4a8-4369-85b0-d28453fe699f"
type: "task"
title: "Decided Sidecar cards fold to one line and the pile of them collapses"
slug: "decided-sidecar-cards-fold-to-one-line"
description: "Settled cards keep their full body (packages/web/src/viewer/components/sidecar-cards.ts:523-573) and pile up in the cards band, which takes up to 45% of the drawer (styles/sidecar.css:286-289). A card whose state is not pending renders as its head plus the settled note, with a disclosure to show the body. When more than one decided card is present the list shows them behind \"N decided\" (collapsed by default) and pending cards stay first and open. Keyboard: the disclosure is a button with aria-expanded. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "A decided card shows one line and expands on demand (viewer test)"
  - "Several decided cards collapse behind an N decided toggle while pending ones stay open (viewer test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
