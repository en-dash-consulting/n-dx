---
id: "2c8294ff-3b4f-4233-9131-3633f93155cd"
level: "task"
title: "Wire trigger controls and live status into Commands section rows"
status: "pending"
priority: "medium"
tags:
  - "web"
  - "ui"
  - "commands"
  - "triggers"
source: "smart-add"
acceptanceCriteria:
  - "Commands with dashboard trigger support show an inline Run button in their Commands section row"
  - "Live status (idle, running, last-run timestamp) is displayed per command using the existing polling infrastructure"
  - "Triggering a command from the Commands section produces the same result as triggering it from its primary view"
  - "Commands without trigger support show a read-only row with the full CLI invocation string using the resolved CLI name"
  - "Running a command updates its status row in real time without a full page reload"
description: "For commands that support dashboard-triggered execution (analyze, plan, work, refresh), add inline Run buttons within the Commands section rows. Display live status (idle, running, last-run timestamp) via the existing scheduler/polling infrastructure. Reuse existing trigger control components to avoid duplication."
---
