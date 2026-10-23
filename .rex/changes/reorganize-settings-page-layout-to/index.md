---
id: "26f04993-67f4-4d3a-a573-fd9d35d448a0"
type: "change"
title: "Reorganize settings page layout to group settings by associated CLI command"
slug: "reorganize-settings-page-layout-to"
intent: "Redesign the settings page section structure so each section corresponds to the CLI command(s) whose behavior its settings control. Replace the current hench-centric layout with command-centric groupings: a top 'General' section for settings shared by all commands (llm.vendor, language), then sections for ndx work, ndx start, ndx analyze/plan, ndx sync, and ndx init. Settings sections should appear in workflow order (general → init → analyze/plan → work → start → sync → export) to reinforce the ndx workflow mental model. Purely aesthetic reorganization — no functional changes to how settings are saved or applied."
acceptanceCriteria:
  - "Settings page has clearly labeled sections corresponding to ndx CLI commands or 'General / All Commands'"
  - "Each setting appears in exactly one section with no duplication across sections"
  - "Section headers show the associated CLI command (e.g., 'ndx work', 'ndx start', 'ndx analyze / plan')"
  - "Settings that affect all commands appear in the top 'General' section"
  - "Sections appear in workflow order: General → ndx init → ndx analyze / plan → ndx work → ndx start → ndx sync → ndx export"
  - "Existing functionality of all settings controls is unchanged after reorganization"
touches:
  - "dc5e6696-7575-4983-b8c5-a73711bc4d8f"
priority: "medium"
tags:
  - "settings"
  - "web"
  - "ux"
source: "smart-add"
---
