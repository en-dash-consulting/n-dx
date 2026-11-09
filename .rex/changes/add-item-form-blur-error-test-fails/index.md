---
id: "1fb49de7-0662-445d-8094-8596a1b114de"
type: "change"
title: "add-item-form blur-error test fails under the full web viewer suite but passes alone"
slug: "add-item-form-blur-error-test-fails"
intent: "Out-of-scope finding from the adversarial review of 52b2ecff (MemoryPanel/ConcurrencyPanel removal). Running `pnpm --filter @n-dx/web exec vitest run tests/unit/viewer` (245 files) failed one test: packages/web/tests/unit/viewer/add-item-form.test.ts:181 \"shows field-level error styling after blur on empty title\", where titleInput lacked `rex-add-form-input-error`. Running that file alone passes 9/9. Neither the file nor add-item-form.ts changed on this branch (git log main..HEAD is empty). Likely cause: the blur handler's re-render isn't awaited, so the test depends on timing and fails under load, or it depends on test order or shared DOM state. Verdict: out-of-scope (pre-existing flake). Options: (a) wrap the assertion in vi.waitFor or flush the Preact render after blur. This is cheap and recommended if the cause is timing. (b) Isolate DOM state between tests if the cause is test order. Find out which before fixing."
acceptanceCriteria:
  - "The blur-error test in add-item-form.test.ts passes in 10 consecutive runs of the full tests/unit/viewer folder"
  - "The fix makes the test wait for the blur-triggered render (or isolates the state it shares), not loosen the assertion"
touches:
  - "8230a96e-0108-494d-879b-4a76f7ee4360"
fix: true
priority: "medium"
discoveredFrom: {"item":"52b2ecff-be44-4870-a115-d6a36489aed7","run":"f6661724-3a9e-411b-8842-f79b306fab30"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "flaky-test"
source: "ndx-adversarial-review"
---
