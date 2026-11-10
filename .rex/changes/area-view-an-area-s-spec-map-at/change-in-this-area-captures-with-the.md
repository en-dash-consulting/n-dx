---
id: "0987fa69-e981-4318-b940-cadc8540fc25"
type: "task"
title: "\"+ Change in this area\" captures with the shortlist limited to the area"
slug: "change-in-this-area-captures-with-the"
description: "AD6: the area view's \"+ Change in this area\" opens capture with the placement shortlist limited to this area's capabilities and constraints, so a change can be added already placed (Add & place, from #896) and skip the Inbox. With nothing chosen it lands in the Inbox as usual. The server-side shortlist takes an optional area filter."
acceptanceCriteria:
  - "The capture opened from the area view offers only that area's capabilities and constraints as placement targets"
  - "Add & place writes the change placed on the chosen target, not in the Inbox"
  - "Without a choice the change lands in the Inbox"
  - "The shortlist route's area filter is covered by a route test"
priority: "medium"
source: "ndx-capture"
blockedBy:
  - "056a30fd-25f2-428d-a193-308a7c6fcc8b"
---
