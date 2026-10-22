---
id: "fe4ea50b-08ee-4636-ace3-1d60aeb0d4f4"
level: "task"
title: "On a v2 project, Smart Add makes a bare change while the panel still promises LLM proposals"
status: "pending"
priority: "high"
tags:
  - "0.10.0"
  - "v2"
  - "fresh-project"
  - "dashboard"
  - "web"
source: "ndx-capture"
acceptanceCriteria:
  - "On a v2 project the add panel neither says it generates proposals nor calls itself Smart Add; it says the text becomes a change in the Inbox and names the next step"
  - "The v2 preview shows the title each change will get, and the full text is kept as its description"
  - "v1 projects keep the current Smart Add panel and wording"
  - "A viewer test pins the v2 panel wording and the preview title"
description: "On v2, smart-add-preview and smart-add-accept spawn `rex add`, which runs cmdAddChangesFromDescriptions (packages/rex/src/cli/commands/add-change.ts:82). It makes one change per text: the title is the first line cut near 80 characters (titleFrom, :213), and the full text becomes the description. It makes no tasks, acceptance criteria, tags or requirements. The panel (packages/web/src/viewer/components/prd-tree/smart-add-input.ts) still calls itself Smart Add and shows 'Analyzing description and generating proposals...'. A user who types a paragraph sees a cut-off title and none of the breakdown v1 gave, which reads as the title and fields being lost. Recommended for 0.10.0: label the panel honestly as a capture into the Inbox, and say what comes next. An LLM breakdown of a change into tasks is a separate decision."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-22T17:14:31.519Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
