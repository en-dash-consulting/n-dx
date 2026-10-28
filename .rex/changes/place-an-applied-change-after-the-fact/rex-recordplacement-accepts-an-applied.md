---
id: "5c301895-2beb-4613-b873-7807f771d47d"
type: "task"
title: "rex: recordPlacement accepts an applied change with relation touches"
slug: "rex-recordplacement-accepts-an-applied"
description: "In `packages/rex/src/core/change-place.ts`, let `openChange` admit an applied change when the caller places it with relation `touches`. Keep refusing amends on it (new `ChangePlacementErrorKind`, plain message \"Change X is applied; its amendments already reached the map. Place it with touches.\"), and keep refusing cancelled or deleted changes. `suggestPlacement` works for applied changes too. Check `checkV2Rules` and `change-placed-at-close`: a placed applied change must report nothing new. The CLI (`rex change place`), MCP `place_change` and the web `POST /api/rex/changes/:id/place` route (PR 2) pass it through unchanged; update their help and descriptions. Tests in change-place.test.ts and the integration tests for each surface."
acceptanceCriteria:
  - "An applied Inbox change placed with touches clears needsPlacement and leaves changes/inbox/"
  - "Amends on an applied change is refused with its own kind and message"
  - "rex health reports no new finding for the placed change"
  - "CLI, MCP and the web route accept it; tests cover each"
priority: "low"
tags:
  - "inbox-placement"
  - "rex"
source: "ndx-capture"
---
