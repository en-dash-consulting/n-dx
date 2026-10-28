---
id: "a5de1b6c-7c3a-4a92-b7b1-d244cf3ca0ff"
type: "task"
title: "Draft route and Draft with the model button, gated by a feature toggle"
slug: "draft-route-and-draft-with-the-model"
description: "Register a toggle (for example `rex.placementDraft`, default off) in `routes-features.ts`'s registry. Add `POST /api/rex/changes/:id/placement/draft` in `routes-rex/placement.ts`, calling the rex draft function through the gateway; it checks `isFeatureEnabled(projectDir, key)` per call and fails closed (403 with a message naming the toggle). In the detail panel's proposal form and shortlist (`components/prd-tree/change-placement.ts`), show \"Draft with the model\" only when `useFeatureToggle` says it is on; the answer fills the form or selects the picked candidate, and the panel says it came from the model. Every entry point reads the same toggle."
acceptanceCriteria:
  - "The toggle defaults off and appears in the feature toggles settings"
  - "The draft route refuses with the toggle off and returns the draft with it on, writing nothing"
  - "The button appears only with the toggle on and fills the form or selects a candidate"
  - "Route and component tests cover both toggle states"
priority: "low"
tags:
  - "inbox-placement"
  - "web"
source: "ndx-capture"
---
