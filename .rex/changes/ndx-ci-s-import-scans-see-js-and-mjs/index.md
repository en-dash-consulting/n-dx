---
id: "14ed8038-4e93-45f0-96bb-fdc3820918a7"
type: "change"
title: "ndx ci's import scans see .js and .mjs gateway bypasses and unreadable directories"
slug: "ndx-ci-s-import-scans-see-js-and-mjs"
intent: "Two ndx ci scan gaps left open in the product-layer review follow-ups (51a8aed3): the gateway-imports step scans only .ts files, and the restricted-import scan silently skips an unreadable directory outside git. Split out in the 2026-11-06 PRD audit."
touches:
  - "84562611-0193-412e-8642-7f5b0fab1d85"
fix: true
priority: "low"
discoveredFrom: {"item":"51a8aed3-0098-43e1-9f84-87c080ababdd"}
tags:
  - "ndx-ci"
  - "follow-up"
source: "prd-v2-map-audit"
---
