---
id: "946e2ae1-8a5c-4aa4-ba80-ffb1bd2782e0"
level: "task"
title: "settings.spec's feature-toggle API check asserts the response contains the key, which it always does"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "web"
  - "testing"
  - "playwright"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "The project test parses GET /api/features and asserts the sourcevision.ask toggle's enabled value is true after Save"
  - "The assertion fails when the PUT is skipped (verified during the fix)"
description: "Severity: low (the UI assertion after it protects the behaviour; this check adds nothing). Verdict: should-fix.\n\npackages/web/tests/e2e-ui/happy-click/settings.spec.ts, project test: after Save it fetches GET /api/features and asserts JSON.stringify(response) contains \"sourcevision.ask\". The registry response always lists every key, so the assertion passes whether or not the save persisted. Replace it with a parse of the response and an assertion that the sourcevision.ask entry reports enabled."
lastModified: "2026-10-13T19:10:27.446Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
