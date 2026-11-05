---
id: "bad7db13-1603-40a6-95cc-a436d40eafa9"
type: "task"
title: "The fixture extension declares a drawer tab, loaded end to end through a frame key"
slug: "the-fixture-extension-declares-a"
description: "Story 50c (contract half, part 3 of 3). tests/e2e/fixture-extension/ declares a sidecarTab whose page is served by its sidecar and shows the X-Ndx-Base-Path it was given. An e2e starts a hub against a temp ndx home, installs and enables the fixture, issues a frame key through the new route, loads the tab page through the keyed URL, and checks that the same key is refused on /p/<id>/api/status. Keep it fast: the macOS CI job times out at 15 minutes. Reuse the existing fixture and hub e2e helpers; argv assertions need a win32 branch, and extensions.json reads and renames go through the existing retry helpers on Windows."
acceptanceCriteria:
  - "tests/e2e/fixture-extension/ declares a sidecarTab and its sidecar serves the tab page, which reports the base path it received"
  - "An e2e issues a key, loads the tab page through /x/<name>/~f/<key>/..., sees X-Ndx-Base-Path with the key in it, and gets 401 for the same key on /p/<id>/api/status"
  - "The existing extension tests (tests/unit/extension-*.test.js, tests/e2e/extension-*.test.js, tests/e2e/cli-extensions.test.js) still pass, and the new e2e adds no more than a few seconds"
priority: "high"
source: "caos"
---
