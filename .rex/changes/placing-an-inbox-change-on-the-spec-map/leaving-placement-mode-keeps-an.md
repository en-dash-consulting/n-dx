---
id: "b91c7895-1d4e-4804-9a5d-d7233abf891a"
type: "task"
title: "Leaving placement mode keeps an unsaved placement as a draft"
slug: "leaving-placement-mode-keeps-an"
description: "WF10. Leaving placement mode (Esc, the breadcrumb, another tab) with an unsaved pick or edit keeps it as a draft on that change for the browser session (sessionStorage, keyed by change id). The Inbox row and tile show \"draft · <relation> <target>\", and Place resumes at the step it was left with the edits in place. Esc with no edits just leaves. Nothing reaches the PRD until Place; a draft whose change is placed elsewhere is dropped."
acceptanceCriteria:
  - "Leaving with an unsaved pick or edit keeps it, and Place resumes it with the edits"
  - "The Inbox row shows the draft"
  - "No PRD write happens until Place"
  - "A draft is dropped once its change is placed by any route"
priority: "low"
source: "ndx-capture"
blockedBy:
  - "fe39744e-059c-46ec-ad96-a04ce74cd1e4"
---
