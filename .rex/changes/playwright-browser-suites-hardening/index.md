---
id: "d277c5ce-3ec5-4625-9fb6-85c158e5f10a"
type: "change"
title: "Playwright browser suites: hardening from the adversarial review of the manual and happy-click suites"
slug: "playwright-browser-suites-hardening"
intent: "Container for the must-fix and should-fix findings of the 2026-10-13 /ndx-adversarial-review of commits d925158ce and e601237f3 on feat/playwright-manual-and-happy-click: the manual real-vendor Playwright suite (packages/web/tests/e2e-ui-manual) and the happy-click specs (packages/web/tests/e2e-ui/happy-click). Each child task carries its own failure scenario, evidence and solution; the review's not-worth-fixing findings (probe fetch without timeout, trace size on long runs, sweep de-duplication by name) are recorded in the review summary and deliberately not filed."
touches:
  - "ed5d632a-0385-4cbf-87b4-7f1d929eaf30"
priority: "high"
tags:
  - "ndx-adversarial-review"
  - "web"
  - "testing"
  - "playwright"
source: "ndx-adversarial-review"
---
