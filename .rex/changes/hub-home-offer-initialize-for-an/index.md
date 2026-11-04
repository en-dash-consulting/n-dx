---
id: "94e7c673-8696-411f-a60e-07080fd2a14a"
type: "change"
title: "Hub home: offer Initialize for an uninitialized project, with in-card progress"
slug: "hub-home-offer-initialize-for-an"
intent: "When `ndx start` runs in an empty folder (or any folder without n-dx initialized), the hub home page shows a normal project card whose primary action is \"Start working\" (packages/web/src/hub/home.ts:449), linking into `<project>/hench-runs` as if the project were already set up. ProjectCard (hub/overview.ts) carries only supervisor state (healthy/starting/unreachable/stopped) — nothing says whether the project is initialized, so the card cannot tell a fresh folder from a set-up one.\n\nChange the flow for uninitialized projects only, as a UI ease-of-setup improvement: the card knows the project is uninitialized and its primary action becomes \"Initialize\" instead of Start working / Open dashboard. Clicking it locks the card under a loading overlay with progress while init runs; on completion the card unlocks and shows the normal actions for an existing project. Initialized projects are unaffected."
acceptanceCriteria:
  - "The hub overview reports, per project, whether n-dx is initialized there, using the same layout check that decides whether the project server serves its setup wizard"
  - "An uninitialized project's card shows a single primary \"Initialize\" action and no \"Start working\" or dashboard link"
  - "Clicking Initialize runs project initialization without leaving the hub home page, reusing the existing setup path rather than a second implementation of init"
  - "While init runs, the card is covered by a loading overlay showing progress (current step or phase) and its actions cannot be clicked"
  - "On success the card refreshes to the normal actions (Start working, Open dashboard) without a full page reload"
  - "On failure the card leaves the loading state and shows the error with a retry; it never stays locked"
  - "Cards for initialized projects render exactly as they do today; existing tests/unit/hub/home.test.ts cases still pass"
  - "Unit tests cover uninitialized-card rendering and the loading, success and failure states"
amends: [{"target":"f0fc0bff-bffc-4c87-bf87-0854ce249383","delta":"added","summary":"Hub home: offer Initialize for an uninitialized project, with in-card progress","criteria":{"add":[{"id":"c1","text":"The hub overview shall report, for each registered project, whether n-dx is initialized in it."},{"id":"c2","text":"While a project is uninitialized, its hub card shall offer Initialize as its only primary action."},{"id":"c3","text":"While initialization runs from the hub, the project's card shall show progress and block its actions."},{"id":"c4","text":"When initialization from the hub succeeds, the card shall show the actions of an initialized project without a page reload."},{"id":"c5","text":"If initialization from the hub fails, the card shall show the error and offer a retry."}]},"proposed":"The hub home page tells an uninitialized project from an initialized one, and lets the user initialize it from its card with visible progress before offering the normal project actions.","under":"4d62fa6c-ad0d-4e1e-91f8-c2f1ebe696e7","title":"Hub home sets up an uninitialized project in place","type":"capability"}]
priority: "medium"
tags:
  - "hub"
  - "onboarding"
  - "ux"
source: "ndx-capture"
---
