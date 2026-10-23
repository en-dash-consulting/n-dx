---
id: "7a7249e7-1a6b-4e09-bf2c-73a4cea7d4de"
type: "change"
title: "Add visual regression snapshot for ndx init dinosaur output"
slug: "add-visual-regression-snapshot-for-ndx"
intent: "Without a captured baseline, future changes can silently re-break the dinosaur's proportions. Add a lightweight snapshot test that captures the raw ASCII art string so that any character-level change is caught and requires explicit review. This test should sit alongside the existing init integration tests."
acceptanceCriteria:
  - "A snapshot test exists that captures the ASCII art string produced during ndx init"
  - "The snapshot test fails if any character in the dinosaur art is changed without a deliberate snapshot update"
  - "The snapshot file is committed alongside the test and reflects the corrected art from the companion redesign task"
  - "The test runs as part of `pnpm test` without requiring a live Claude API or network call"
touches:
  - "453e030c-021c-4f41-a39f-eb7804e356b4"
priority: "low"
tags:
  - "cli"
  - "testing"
  - "init"
  - "branding"
source: "smart-add"
---
