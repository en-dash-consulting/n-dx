---
id: "3be5b199-ad38-404c-93a5-54369508882f"
level: "task"
title: "Give web's graph-view tests a getBoundingClientRect stub (jsdom returns 0x0)"
status: "pending"
priority: "medium"
tags:
  - "testing"
  - "web"
  - "jsdom"
  - "viewer"
source: "exploration-2026-08-18"
acceptanceCriteria:
  - "Both graph-view failures pass, in isolation and as part of the full web suite"
  - "getBoundingClientRect is stubbed with dimensions that make the asserted transform arithmetic explicit rather than coincidental"
  - "The second failure's cause is confirmed to be the same degenerate geometry, or diagnosed separately if it is not"
  - "A decision is recorded on whether use-pan-zoom needs a zero-size guard in production, filed separately if so"
  - "No assertion was loosened to tolerate the degenerate transform"
description: "NOT WINDOWS-SPECIFIC — the only item under this feature that is not. Filed here because it surfaced in the same triage and blocks the same goal (a green per-package suite), but it will fail identically on ubuntu and macOS.\n\nTwo deterministic failures in packages/web/tests/unit/viewer/graph-view.test.ts:\n  \"recenters the file street view when the focused graph changes\"\n    AssertionError: expected 'translate(0 0) scale(1)' to contain 'translate(0 -40)'\n  \"supports back and forward through clicked dependency preview nodes\"\n    AssertionError: expected 'Current selectionDriven by file: a.ts…' to contain 'src/b.ts'\n\nMECHANISM. src/viewer/hooks/use-pan-zoom.ts:101-109 pans by dividing into the element's measured box:\n\n    const scaleY = vb.h / rect.height;          // rect = svg.getBoundingClientRect()\n    y: vb.y + e.deltaY * scaleY\n\njsdom's getBoundingClientRect() returns all zeros, and there is NO mock for it anywhere in\npackages/web/tests (verified by grep). So scaleY is vb.h / 0 and the pan math is degenerate — the\nasserted \"translate(0 -40)\" is unreachable no matter how long the test waits. Both cases fail at ~3.0s,\nexactly their vi.waitFor 3000ms limit, and both fail in isolation as well as in-suite.\n\nRULED OUT, each by inspection rather than assumption:\n- Not the deltaY clamp at use-pan-zoom.ts:87 — that lives inside the `e.ctrlKey` ZOOM branch, and the\n  test dispatches a wheel event WITHOUT ctrlKey, so it takes the unclamped PAN branch.\n- Not OS-dependent — no filesystem paths, no shell, no file locking, no line endings are involved, and\n  \"src/a.ts\" is a literal in the makeLoadedData fixture rather than a built path.\n- Not a regression from #321 (231c72f3), the last commit to touch this test file — both cases exist in\n  that commit's PARENT, and the parent's use-pan-zoom.ts already divided by rect.height. They are\n  long-standing red that CI never surfaced because it was masking the web package entirely.\n\nFIX OPTIONS:\n1. Stub getBoundingClientRect for these tests (e.g. 800x600) so scaleX/scaleY are finite and the\n   expected transform is derivable. Pick dimensions that make the assertion's arithmetic explicit — if\n   the test expects deltaY 40 to yield exactly -40, that requires scaleY === 1, i.e. rect.height === vb.h,\n   so state that relationship in the test rather than leaving it implicit.\n2. A shared setup stub in packages/web/tests/setup/ if other view tests would benefit; web already loads\n   tests/setup/local-storage.ts, so there is an established place for this.\n\nAlso consider whether use-pan-zoom should guard against a zero-sized element in production — a 0-height\ncontainer would produce a non-finite viewBox in a real browser too, during first paint or in a hidden\ntab. If that is a genuine risk, record it as a separate defect rather than folding a production change\ninto a test fix.\n\nThe second failure's mechanism was not traced past the shared root cause; confirm it is the same\ndegenerate-geometry problem rather than assuming it, since its symptom (navigation state showing a.ts\ninstead of src/b.ts) is not obviously geometric."
---
