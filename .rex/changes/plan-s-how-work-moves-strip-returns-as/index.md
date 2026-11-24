---
id: "fc714e62-19dd-47a1-a700-214c3324e29d"
type: "change"
title: "Plan's How work moves strip returns as the stage filter, and the Inbox follows the flow"
slug: "plan-s-how-work-moves-strip-returns-as"
summary: "Plan shows how work moves from the Inbox to done as a row of clickable stages; clicking one focuses both the product areas and the Inbox on it. The Inbox's wording and buttons follow the design so each item says what pressing it does next."
intent: "From the 'n-dx Plan Page Design' artifact (Plan page board): the \"How work moves\" row with \"Click a stage to focus on it\" and Show all, the product areas' \"Drag an inbox item onto an area to plan it\", the Inbox title, hint and empty text in Solo and Team, and the Inbox buttons that name the step (\"Plan in <area>\" / \"Accept → <area>\"). Change 9b482f7e removed the lifecycle band and 533600ce moved the stage filter into chips on Product areas; this brings the strip back in the design's form as the one stage filter. The user chose n-dx's own stages over the design's (Submitted, Triage, Planned, In progress, Closed): Inbox → Proposed → Ready → In progress → Awaiting apply, with no Closed stage. Styling stays on the dashboard's tokens."
acceptanceCriteria:
  - "Plan › Create shows How work moves: Inbox, Proposed, Ready, In progress and Awaiting apply as buttons in order with arrows between, each with its count and a one-line description, under 'Click a stage to focus on it' and a Show all while one is focused"
  - "Clicking a stage focuses both the product areas and the Inbox panel on it; clicking it again or Show all clears the focus"
  - "The Inbox panel, the product areas and the drop zones carry the design's instructions in Solo and Team"
  - "Inbox buttons read 'Accept → <area>' in Team and 'Plan in <area>' in Solo"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "medium"
discoveredFrom: {"item":"533600ce-bcd3-4632-812d-4d286c4c078d"}
tags:
  - "web"
  - "plan"
  - "design"
source: "ndx-capture"
---
