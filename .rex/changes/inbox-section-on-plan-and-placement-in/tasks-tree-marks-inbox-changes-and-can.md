---
id: "480edc01-5573-43aa-b559-026a53513984"
type: "task"
title: "Tasks tree marks Inbox changes and can filter to them"
slug: "tasks-tree-marks-inbox-changes-and-can"
description: "In the Tasks section's PRD tree (`components/prd-tree/`), show an \"Inbox\" badge beside the Change badge on a change rex holds for placement (`awaitsPlacement`), with an accessible label. Add an \"In the Inbox\" facet beside the Status and Tags filters that shows only those changes. Today Inbox changes (\"Call graph covers C#…\", \"Condense the Workflow settings page…\") sit among placed ones with no marker."
acceptanceCriteria:
  - "Inbox changes carry an Inbox badge in the tree; placed and applied ones do not"
  - "The In the Inbox facet filters the tree to open Inbox changes and clears with Clear facets"
  - "Tree tests cover the badge and the facet"
priority: "medium"
tags:
  - "inbox-placement"
  - "web"
source: "ndx-capture"
---
