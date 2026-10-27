---
id: "dbb2f5ef-4e60-431a-9e9f-8ade8f2eba28"
type: "change"
title: "Add regression tests for ANSI color reset and line-boundary consistency"
slug: "add-regression-tests-for-ansi-color"
intent: "Add targeted tests that assert colorized CLI output strings always contain a reset code at the end of each colored segment. Tests should cover the shared color utility and at least one representative output path from each CLI tool (rex, hench, sourcevision). Prevents future contributors from reintroducing missing resets when adding new color usage."
acceptanceCriteria:
  - "Unit tests assert that every string returned by the color utility ends with the ANSI reset sequence"
  - "At least one integration-level test per CLI tool verifies no color bleed across output lines in TTY mode"
  - "Tests fail if a colorized string is returned without a trailing reset"
  - "NO_COLOR and non-TTY paths are also covered (no ANSI codes emitted at all)"
touches:
  - "eb21a965-6d17-4ee7-b6bd-0f1e6d07ff33"
priority: "medium"
tags:
  - "cli"
  - "ansi"
  - "color"
  - "test"
source: "smart-add"
---
