---
id: "e093ac5d-ac9b-4a2a-bcec-e8d8094f9316"
type: "change"
title: "Turn the .n-dx* ratchet into a wall"
slug: "turn-the-n-dx-ratchet-into-a-wall"
intent: "Once the inventory is empty, make tests/e2e/layout-literal-policy.test.js treat .n-dx* literals the way it already treats .rex/, .hench/ and .sourcevision/: any site outside ALLOWED fails with its file and line. Retire tests/layout-literal-inventory.md's ratchet table (or reduce it to the ALLOWED explanation)."
acceptanceCriteria:
  - "A new .n-dx* literal anywhere outside ALLOWED fails the policy test with file and line (test)"
  - "The inventory file no longer carries a ratchet count"
touches:
  - "a7c0061e-eb80-473b-84b2-861194fbcc47"
priority: "medium"
tags:
  - "pr-29"
  - "lane-models-analysis"
source: "roadmap"
blockedBy:
  - "66397a69-5347-4659-8852-4ff1724ae261"
---
