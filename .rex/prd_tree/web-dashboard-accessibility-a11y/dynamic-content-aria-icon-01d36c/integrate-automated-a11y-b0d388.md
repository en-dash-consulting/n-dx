---
id: "b0d38827-f7b8-4b35-8662-d36bcb6109d8"
level: "task"
title: "Integrate automated a11y regression tests into CI and document screen-reader compatibility"
status: "pending"
priority: "medium"
tags:
  - "a11y"
  - "testing"
  - "ci"
  - "documentation"
source: "smart-add"
acceptanceCriteria:
  - "Axe-core integration tests run against every major dashboard route in CI (zones, findings, import graph, PR tab, Rex PRD tree, hench monitor, settings)"
  - "CI fails if any axe violation of severity 'critical' or 'serious' is introduced"
  - "Tests cover both light and dark theme variants for contrast-related violations"
  - "A docs/accessibility.md (or TESTING.md section) documents: supported assistive technologies, known limitations, manual test procedure, and the table-view fallback for graph views"
  - "Axe tests are tagged (e.g. 'a11y') so they can be run independently with `pnpm test --filter a11y`"
description: "Prevent future a11y regressions by adding axe-core accessibility audits to the existing Vitest/Playwright test suite that run on every route in both light and dark themes. The tests should assert zero critical or serious axe violations as a hard CI gate. Additionally, document the manual screen-reader test procedure (NVDA+Chrome, VoiceOver+Safari) and known limitations (graph nodes require table-view fallback for full data access) in TESTING.md or a new docs/accessibility.md."
---
