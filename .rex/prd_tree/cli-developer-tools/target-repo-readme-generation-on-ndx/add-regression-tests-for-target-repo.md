---
id: "0bf2217f-85cb-4154-911b-71028142cbc9"
level: "task"
title: "Add regression tests for target-repo README generation and proposed-file fallback"
status: "completed"
priority: "high"
tags:
  - "cli"
  - "init"
  - "tests"
source: "smart-add"
startedAt: "2026-06-01T15:06:06.281Z"
completedAt: "2026-06-01T15:12:19.966Z"
endedAt: "2026-06-01T15:12:19.966Z"
resolutionType: "code-change"
resolutionDetail: "Added tests/e2e/cli-init-readme.test.js with 6 integration tests covering all 5 acceptance criteria. Tests run cross-platform against synthetic temp repos and are auto-wired into CI via the vitest glob (tests/**/*.test.js). They are intentionally red until the two sibling implementation tasks ship (TDD ordering)."
acceptanceCriteria:
  - "Integration test: ndx init in a temp dir with no README produces README.md whose content references the temp project's manifest name and does not contain the strings 'n-dx', '@n-dx/core', or 'AI-powered development toolkit'"
  - "Integration test: ndx init in a temp dir with an existing README.md leaves the original byte-for-byte identical and writes README.proposed.md with synthesized content"
  - "Integration test: existing README variants (README, README.rst, readme.md) also trigger the proposed-file path"
  - "Test asserts a second ndx init run overwrites README.proposed.md but still does not touch the original README"
  - "Tests are wired into the existing ndx init test suite and run in CI on all supported platforms"
description: "Cover both init code paths with integration tests so future refactors cannot reintroduce n-dx-flavored content or accidentally clobber a user's README. Tests run against synthetic target repos in a temp dir to isolate from the n-dx repo itself."
---
