---
id: "f45adbe1-c3b7-4bc9-aae7-e00dd961d4c8"
level: "task"
title: "Fail a web test file that leaves a preact frame-fallback timer pending at teardown"
status: "completed"
priority: "medium"
tags:
  - "0.7.1"
  - "test-determinism"
  - "pr-t"
  - "flake"
  - "web"
blockedBy:
  - "ecaa65cf-a0bb-4f22-8cb4-58d82b1ef9ea"
source: "Adversarial review of hench run 22a26185-d8b8-486b-af52-0e49778e1a05 (task 32083905), finding 3"
startedAt: "2026-09-25T06:59:37.669Z"
completedAt: "2026-09-25T07:29:37.946Z"
endedAt: "2026-09-25T07:29:37.946Z"
resolutionType: "code-change"
resolutionDetail: "Added tests/setup/preact-frame-leak-guard.ts (wraps setTimeout/clearTimeout, tracks setTimeout(fn,35) pairs still pending at afterAll, jsdom-only), wired into packages/web/vitest.config.ts setupFiles. Canary test proves detection. Guard surfaced 3 real leaks beyond ecaa65cf's 19 files, all fixed: refresh-panel.test.ts (unwrapped afterEach unmounts + a shared mocked Response reused by both the tested endpoint and useCliName's background /api/project fetch, causing a body-already-read error that flipped state outside act()), pr-markdown.test.ts (unwrapped afterEach unmount + a settle helper that waited outside act() instead of inside per-step act() calls), smart-add-input.test.ts (same settle-outside-act pattern in its one real-timers test). Full web suite passes 3x consecutively under the guard; vitest-timeout-policy and wall-clock-inventory-policy tests still pass."
acceptanceCriteria:
  - "packages/web/vitest.config.ts loads a setup file that fails any test file with a preact frame-fallback timer still pending at afterAll, naming the file and the count."
  - "A canary test proves the guard detects an unwrapped render, so a change to preact's fallback constant fails loudly instead of silently disabling the guard."
  - "Reverting the act() wrapping in use-polling-suspension.test.ts makes that file fail under the guard; restoring it passes."
  - "The full @n-dx/web suite passes under the guard with no allowlist, and tests/unit/vitest-timeout-policy.test.js still passes."
description: "Nothing in the repository detects the preact frame-fallback leak. Every test in the files fixed by 32083905 (and by ecaa65cf) passes identically with the act() wrapping removed, so the next `render(h(Thing), root)` written outside act() reintroduces the post-teardown `ReferenceError: cancelAnimationFrame is not defined` and the suite stays green until it randomly is not. That leaves the parent criterion \"a suite that reports every test passed cannot also exit non-zero from a post-teardown timer\" as a property no test checks.\n\nAdd a setup file to `setupFiles` in `packages/web/vitest.config.ts`, for example `tests/setup/preact-frame-leak-guard.ts`. It wraps `globalThis.setTimeout` and `clearTimeout`, records the ids of timers scheduled with a delay of exactly 35ms (the `RAF_TIMEOUT` preact/hooks' `afterNextFrame` uses in 10.29.x), removes an id when it is cleared, and in `afterAll` fails the file with a message naming the file and the count still live. It should explain the fix: commit the render inside `preact/test-utils` act(). The review prototyped this in about 25 lines and confirmed it counts real pairs.\n\nDesign constraints:\n- Only jsdom-environment files can leak. The guard should do nothing in node-environment files, or count harmlessly and never fail them.\n- Removing a fired timer's id matters as much as removing a cleared one. A pair that fires before teardown is harmless, so the guard must track \"still pending at afterAll\", not \"ever scheduled\". Wrap the callback so a fired timer deletes its own id.\n- 35ms is a preact internal. Pin the check with a canary test that renders a tiny component with a state-setting useEffect outside act() and asserts the guard sees exactly one pending pair. A preact upgrade that changes the constant then fails loudly instead of silently disabling the guard. Put the constant in one named place with a comment pointing at node_modules/preact/hooks/src/index.js `RAF_TIMEOUT`.\n- A legitimate `setTimeout(fn, 35)` in a test or in viewer source would be a false positive. Check the suite and viewer source for one, and document the collision if it exists.\n\nThis is blocked by ecaa65cf because the guard fails the 19 files that task fixes. If any file still trips it after ecaa65cf lands, fix that file in this task; do not add an allowlist. Keep `hookTimeout >= testTimeout` in the web vitest config (tests/unit/vitest-timeout-policy.test.js). Test-only change: no production code and no changeset."
lastModified: "2026-09-25T07:29:38.318Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
