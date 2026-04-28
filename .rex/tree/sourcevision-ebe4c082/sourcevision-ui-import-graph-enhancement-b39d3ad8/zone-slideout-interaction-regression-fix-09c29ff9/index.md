---
id: "09c29ff9-de59-49d7-a1a7-66120c7cb933"
level: "task"
title: "Zone Slideout Interaction Regression Fix"
status: "completed"
source: "smart-add"
startedAt: "2026-03-06T17:07:35.610Z"
completedAt: "2026-03-06T17:07:35.610Z"
description: "The SourceVision Zones graph no longer opens the detail slideout panel when clicking zone nodes or the info button — instead, clicks collapse the node. The info button also lacks visual affordance indicating it reveals more information. This feature restores correct click behavior and improves the info button's discoverability."
---

## Subtask: Restore zone node click and info button routing to slideout panel

**ID:** `a76a7559-0dc6-4bb8-bcf5-866f39ab4f50`
**Status:** completed
**Priority:** high

Clicking a zone node or its info button currently collapses the node instead of opening the detail slideout panel. Audit the click event handlers on zone graph nodes and the info button, identify where the event is being consumed or incorrectly routed, and restore the behavior so node clicks open the slideout. The 'Load more' action should similarly not collapse the node.

**Acceptance Criteria**

- Clicking a zone node opens the detail slideout panel instead of collapsing the node
- Clicking the info button on a zone node opens the detail slideout panel
- The 'Load more' action expands data inline without collapsing the node
- Collapsing a node only occurs when explicitly triggered via a dedicated collapse affordance
- Slideout opens with correct zone data matching the clicked node

---

## Subtask: Improve info button visual affordance on zone nodes

**ID:** `aee318ff-ac6b-476c-8414-075f04c4e988`
**Status:** completed
**Priority:** medium

The info button on zone nodes is not visually clear enough for users to understand it reveals additional details. Update the button's icon, tooltip, and styling to make its purpose obvious — it should look like an interactive 'more info' control, not a passive label or toggle.

**Acceptance Criteria**

- Info button uses a recognizable information icon (e.g. 'ℹ' or outlined info circle) distinct from collapse controls
- Hovering the info button displays a tooltip with text such as 'View zone details'
- Info button has a visible hover/focus state indicating interactivity
- Info button is visually distinct from node collapse/expand controls to prevent confusion

---
