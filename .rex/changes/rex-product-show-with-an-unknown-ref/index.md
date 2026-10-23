---
id: "11252d47-b102-4459-b5a4-f31a0c89063a"
type: "change"
title: "rex product show with an unknown ref refuses with \"Use get_product to see the product layer\""
slug: "rex-product-show-with-an-unknown-ref"
intent: "Out-of-scope finding from the adversarial review of 93d19cfa (change place refusal kinds). Pre-existing.\n\nScenario: `rex product show nope` → capabilityReport throws ProductReportError (core/product-report.ts:138) `\"nope\" ... Use get_product to see the product layer.` product.ts:61 does not catch it, so the CLI user is told to use an MCP tool; they need `rex product show`.\n\nReachable: every `rex product show <ref>` with a wrong or non-capability ref. Verdict: out-of-scope, low.\n\nOptions: (1) same pattern as ChangePlacementError: give ProductReportError a kind + plain, CLI renders \"List them with `rex product show`\" — recommended, keeps get_capability MCP text byte-identical (0.9.0 soft freeze). (2) Make the core text surface-neutral — changes MCP text, so no.\n\nDecided (Ryan, 2026-10-09): option 1. Same pattern as ChangePlacementError in 93d19cfa: give ProductReportError a kind and a surface-neutral plain message; rex product show renders its own refusal naming `rex product show`. The get_capability MCP refusal text stays byte-identical (0.9.0 soft freeze)."
acceptanceCriteria:
  - "rex product show <unknown ref> is refused naming `rex product show`, not get_product (test)"
  - "get_capability MCP refusal text is unchanged (existing MCP tests pass without edits to expected strings)"
touches:
  - "70443075-8352-48a4-a8ed-799505872d4b"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
