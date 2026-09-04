---
id: "514d0d03-868a-4eaf-abeb-3e2abdd38bd5"
level: "task"
title: "Add gated Ask tab and prompt/response view shell"
status: "pending"
priority: "medium"
tags:
  - "web"
  - "viewer"
  - "sourcevision"
source: "ndx-capture"
acceptanceCriteria:
  - "SOURCEVISION_TABS gains an \"ask\" entry with featureGate \"sourcevision.ask\"; the tab is hidden when the gate is off"
  - "The view is registered in view-id.ts, view-routing.ts, and view-registry.ts, and a direct URL to the Ask tab restores it on reload"
  - "The panel renders a labelled textarea plus submit control, and distinguishes idle, submitting, answered, and error states visually"
  - "Submitting an empty or whitespace-only prompt is a no-op that does not issue a request"
  - "A unit test covers the state transitions and the gate-off hidden case"
description: "Add the \"Ask\" tab to the SourceVision tab registry and the view shell behind it. Mirrors the existing pr-markdown tab: an entry in SOURCEVISION_TABS with an icon, label, minPass, and featureGate of \"sourcevision.ask\", a new view module under packages/web/src/viewer/views/, and registration in view-id.ts / view-routing.ts / view-registry.ts so the tab is deep-linkable like its siblings.\n\nThe shell owns the prompt textarea, the submit control, and the four display states (idle, submitting, answered, error). It does not call the LLM itself -- it consumes the endpoint from the sibling task."
lastModified: "2026-09-01T14:04:27.870Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
