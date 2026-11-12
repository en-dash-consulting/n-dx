---
id: "e990995f-bad2-4b7c-80d2-41755cc3b24e"
type: "task"
title: "Default rex.placementDraft to on"
slug: "default-rex-placementdraft-to-on"
description: "Set defaultValue to true in FEATURE_REGISTRY and the fallback in components/prd-tree/change-placement.ts; the draft endpoint's self-enforced gate in routes-rex/placement.ts stays. Update tests that assume it is off."
acceptanceCriteria:
  - "With nothing stored, an Inbox change's placement form shows Draft with the model"
  - "Storing false hides the button and the draft endpoint refuses"
priority: "low"
tags:
  - "feature-flags"
source: "ndx-capture"
---
