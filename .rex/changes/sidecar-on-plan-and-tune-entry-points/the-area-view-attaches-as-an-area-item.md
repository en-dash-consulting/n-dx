---
id: "3323ffdb-0675-4e30-8bc0-e65ffbfddb53"
type: "task"
title: "The area view attaches as an area item: Explain, and Plan in this area"
slug: "the-area-view-attaches-as-an-area-item"
description: "SP6. use-sidecar-attachment.ts gains an `area` page item kind for the area view (ref = the area id), whose wanted lens is Explain; the server's Explain packet already handles an area target. The area view header offers \"Plan in this area\", which switches the session to the Plan lens targeted at the area (the Plan packet slices the map around its target). A capability selected in the area view still attaches as a capability."
acceptanceCriteria:
  - "On the area view pageItemFor returns an area item and the lens is Explain"
  - "Plan in this area switches to the Plan lens with the area as target"
  - "A selected capability attaches as a capability"
  - "Unit tests cover the area item and its lens"
priority: "medium"
source: "ndx-capture"
---
