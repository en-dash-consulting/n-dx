---
id: "27881581-eb6d-458c-b36b-a6a3b9968085"
level: "task"
title: "Commit the Guide modal clicks and Escape dispatch in accessibility.test.ts inside act()"
status: "pending"
priority: "medium"
tags:
  - "0.7.1"
  - "test-determinism"
  - "pr-t"
  - "flake"
  - "web"
source: "Adversarial review of hench run 5499fb4a (task ecaa65cf), finding 1; confirmed at HEAD in the PR T session review 2026-09-25"
acceptanceCriteria:
  - "Every click, keyboard dispatch, render and unmount in accessibility.test.ts commits inside act()."
  - "A temporary ever-armed probe counting setTimeout(_, 35) reports 0 armed for the file (down from 6), reported in the resolution detail."
  - "The Escape test no longer relies on fixed sleeps for preact's effect scheduling."
  - "accessibility.test.ts and the full @n-dx/web suite pass under the frame-leak guard."
description: "Task ecaa65cf wrapped the mounts in `packages/web/tests/unit/viewer/accessibility.test.ts` in act(), but the \"Guide modal accessibility\" block still commits outside act() six times. The five `btn?.click()` calls open the Guide modal (the tests \"guide button has aria-expanded=true when open\", \"open guide modal has role=dialog and aria-modal\", \"guide modal has descriptive aria-label\", \"close button has aria-label\" and \"Escape key closes the guide modal\"), and `window.dispatchEvent(new KeyboardEvent(\"keydown\", { key: \"Escape\", bubbles: true }))` closes it. Each click or dispatch commits a Guide mount or unmount whose effect deps changed, so preact/hooks arms its real requestAnimationFrame plus `setTimeout(fn, 35)` pair. The review measured armed=6.\n\nToday the file ends with zero pending pairs only because this block runs first and about 28 slower tests follow it, so every pair fires while jsdom is still up. The frame-leak guard from f45adbe1 (`packages/web/tests/setup/preact-frame-leak-guard.ts`) checks for timers still pending at afterAll, so it passes this file. Moving the block to the end, trimming the trailing tests, or appending a fast test would leave the pairs live at teardown and bring back `ReferenceError: cancelAnimationFrame is not defined`.\n\nFix: the file already imports act(). Wrap each of the five clicks and the Escape dispatch in `act(() => { ... })`. With the click committed inside act(), the modal's effects, including registration of the Escape handler, run synchronously, so the \"Escape key closes the guide modal\" test no longer needs its two `setTimeout(r, 50)` sleeps or its comment that \"Preact schedules effects via rAF -> needs multiple event loop ticks\". Replace those with direct assertions after the act() calls, and keep whatever `flush()`/`waitFor` the component's own async work still requires. Sweep the rest of the file for any other unwrapped click, dispatch or render.\n\nVerify with an ever-armed probe, not the live-at-teardown guard: a temporary setup that counts every `setTimeout(_, 35)` scheduled while the file runs. It should report 0 armed for accessibility.test.ts, down from 6. Test-only change: no production code and no changeset."
lastModified: "2026-09-25T13:48:43.974Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
