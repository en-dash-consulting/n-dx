---
id: "08b9e858-4312-4945-9dd5-6c211884d5f6"
level: "task"
title: "Add rex product and rex change commands; ndx add creates a change"
status: "pending"
priority: "medium"
tags:
  - "pr-18"
  - "lane-rex-surface"
  - "rex"
  - "core"
source: "roadmap"
acceptanceCriteria:
  - "Each verb has help text and tests"
  - "ndx add output names the created change and its placement"
  - "rex product edit and rex change/ndx add use distinct flags for capability criteria and acceptance criteria, and the help text says so"
description: "rex product show, rex product edit [--editorial], rex change place, rex change apply. ndx add, smart-add and capture always create a change and propose placement.\n\nFlags: --criterion sets a work item's acceptanceCriteria, as rex add already does (#511); a capability's criteria use a distinct flag on rex product edit (for example --capability-criterion). Help text names which is which."
lastModified: "2026-10-08T18:56:28.144Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
