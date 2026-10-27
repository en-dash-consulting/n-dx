---
id: "0bf2217f-85cb-4154-911b-71028142cbc9"
type: "change"
title: "Add regression tests for target-repo README generation and proposed-file fallback"
slug: "add-regression-tests-for-target-repo"
intent: "Cover both init code paths with integration tests so future refactors cannot reintroduce n-dx-flavored content or accidentally clobber a user's README. Tests run against synthetic target repos in a temp dir to isolate from the n-dx repo itself."
acceptanceCriteria:
  - "Integration test: ndx init in a temp dir with no README produces README.md whose content references the temp project's manifest name and does not contain the strings 'n-dx', '@n-dx/core', or 'AI-powered development toolkit'"
  - "Integration test: ndx init in a temp dir with an existing README.md leaves the original byte-for-byte identical and writes README.proposed.md with synthesized content"
  - "Integration test: existing README variants (README, README.rst, readme.md) also trigger the proposed-file path"
  - "Test asserts a second ndx init run overwrites README.proposed.md but still does not touch the original README"
  - "Tests are wired into the existing ndx init test suite and run in CI on all supported platforms"
touches:
  - "406b4b7a-eab0-45e0-ba4c-b0b9bc9dc9b9"
priority: "high"
tags:
  - "cli"
  - "init"
  - "tests"
source: "smart-add"
---
