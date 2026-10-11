---
id: "10f16d23-0f2e-4d24-99a0-6852426fdefe"
level: "task"
title: "Prove with a test that settings pages render while the analysis data is still loading"
status: "pending"
priority: "high"
tags:
  - "0.10.0"
  - "robot-wrangler-redesign"
  - "rw-stack-2"
source: "claude-code: Robot Wrangler redesign session 2026-10-10 (PR stack) — follow-up to b9a59e46, whose test did not exercise the behaviour"
acceptanceCriteria:
  - "The test fails when the `loading ? null :` gate is put back in main.ts (verified by temporarily reverting it), and passes on this branch."
  - "It covers all four settings views (robot-wrangler, project, workflow, commands), each rendering its own content while loading is true."
  - "It shows an analysis view still renders the loading state while loading is true."
  - "No behaviour change to main.ts beyond extracting a helper, if one is needed."
  - "`pnpm --filter @n-dx/web test` and the package typecheck pass."
description: "Commit 62b9b8104 removed the gate in `packages/web/src/viewer/main.ts` that rendered the settings overlay's content as `loading ? null : renderActiveView(view, viewCtx)`. Its test, `packages/web/tests/unit/viewer/main-settings-loading.test.ts`, only asserts which views `isSettingsView` accepts, so it would still pass if the gate came back.\n\nReplace or extend that test so it proves the behaviour:\n- Render the shell with `useAppData` mocked to report `loading: true` (and empty data). Stub `fetch` for the API calls the settings views make.\n- Navigate to `/robot-wrangler`, `/project`, `/workflow` and `/commands` in turn, and assert each page's own content renders inside `.settings-overlay-content` (for example its header title).\n- For an analysis view (for example the overview), assert the loading state still shows while `loading` is true.\n\nIf `main.ts`'s app is impractical to render in jsdom, extract the overlay-content decision into a small exported helper (for example `settingsOverlayContent(view, loading, ctx)`) used by `main.ts`. Test that helper, plus a render of `SettingsOverlay` with its output. Do not change the behaviour itself."
lastModified: "2026-10-11T00:19:11.182Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
