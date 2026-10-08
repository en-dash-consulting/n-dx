---
id: "514d0d03-868a-4eaf-abeb-3e2abdd38bd5"
level: "task"
title: "Add gated Ask tab and prompt/response view shell"
status: "completed"
priority: "medium"
tags:
  - "web"
  - "viewer"
  - "sourcevision"
source: "ndx-capture"
startedAt: "2026-09-04T13:57:22.027Z"
completedAt: "2026-09-04T14:12:51.243Z"
endedAt: "2026-09-04T14:12:51.243Z"
resolutionType: "code-change"
resolutionDetail: "Added the gated \"ask\" tab to SOURCEVISION_TABS, the AskView shell under packages/web/src/viewer/views/ask.ts, and registration in view-id.ts / view-routing.ts / view-registry.ts. 19 new unit tests cover the four state transitions, the empty-prompt no-op, and the gate-off hidden case."
acceptanceCriteria:
  - "SOURCEVISION_TABS gains an \"ask\" entry with featureGate \"sourcevision.ask\"; the tab is hidden when the gate is off"
  - "The view is registered in view-id.ts, view-routing.ts, and view-registry.ts, and a direct URL to the Ask tab restores it on reload"
  - "The panel renders a labelled textarea plus submit control, and distinguishes idle, submitting, answered, and error states visually"
  - "Submitting an empty or whitespace-only prompt is a no-op that does not issue a request"
  - "A unit test covers the state transitions and the gate-off hidden case"
description: "Add the \"Ask\" tab to the SourceVision tab registry and the view shell behind it. Mirrors the existing pr-markdown tab: an entry in SOURCEVISION_TABS with an icon, label, minPass, and featureGate of \"sourcevision.ask\", a new view module under packages/web/src/viewer/views/, and registration in view-id.ts / view-routing.ts / view-registry.ts so the tab is deep-linkable like its siblings.\n\nThe shell owns the prompt textarea, the submit control, and the four display states (idle, submitting, answered, error). It does not call the LLM itself -- it consumes the endpoint from the sibling task."
commits:
  - {"hash":"d21d0ab9d291fe444726d038415d8cddd5fc8e8e","author":"endash-shal","authorEmail":"162359954+endash-shal@users.noreply.github.com","timestamp":"2026-09-08T13:03:14-07:00"}
  - {"hash":"8a117e930e44eec6ff73f7844fc32c05e999cb13","author":"endash-shal","authorEmail":"162359954+endash-shal@users.noreply.github.com","timestamp":"2026-09-10T11:18:57-07:00"}
lastModified: "2026-09-04T14:12:51.271Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
