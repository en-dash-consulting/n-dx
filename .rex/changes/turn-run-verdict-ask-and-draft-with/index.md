---
id: "caa42830-41db-48b4-baff-efec5ea9f213"
type: "change"
title: "Turn run verdict, Ask and Draft with the model on by default"
slug: "turn-run-verdict-ask-and-draft-with"
intent: "From the 2026-11-12 feature-flag audit. Three finished features are still off by default:\n\n- hench.runVerdict (since 2026-10-28): a verdict banner on a task whose latest run did not complete. Read-only, fixed rules, no model call.\n- sourcevision.ask (since 2026-09-08): the Ask page, the Explain buttons on Problems and Suggestions, and Ask's two PRD write endpoints. Each question spends tokens, and only when the user asks.\n- rex.placementDraft (since 2026-10-27): Draft with the model in an Inbox change's placement form. One model call per click; it writes nothing.\n\nChange each one's defaultValue in FEATURE_REGISTRY to true, along with the matching viewer fallbacks (components/prd-tree/run-verdict-banner.ts, main.ts and views/stage-pages.ts for Ask, components/prd-tree/change-placement.ts). Their route gates stay, so storing false still turns a feature off. One task per toggle, so any of them can be dropped or done on its own."
acceptanceCriteria:
  - "With nothing stored, the run verdict banner, the Ask page and Explain buttons, and Draft with the model all show"
  - "Storing false for any of them hides it, and its server routes refuse as they do today"
  - "Ask and Draft with the model make no model call until the user asks a question or presses Draft"
  - "docs/guide/configuration.md describes the three as on by default"
  - "A patch changeset for @n-dx/web"
touches:
  - "dc5e6696-7575-4983-b8c5-a73711bc4d8f"
priority: "low"
tags:
  - "feature-flags"
  - "web"
source: "ndx-capture"
---
