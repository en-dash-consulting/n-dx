---
id: "5786aceb-fcb5-422d-abec-9701f8db8b54"
type: "task"
title: "ndx work's Inbox refusal names the dashboard's Inbox"
slug: "ndx-work-s-inbox-refusal-names-the"
description: "`inboxRefusal` in `packages/hench/src/agent/planning/work-selection.ts` refuses a task under an Inbox change with the hint \"Place it first with 'rex change place' (MCP: place_change), then run '<cli> work --task=<ref>' again.\" Add the dashboard: \"Place it from the Inbox on the dashboard's Plan page, with 'rex change place', or with MCP place_change, then run …\". When nothing fits, mention `rex change place <id> --propose`.\n\nKeep the CLI name resolution (`cliName`) as is. Update `tests/integration/v2-inbox-refusal.test.ts` and any snapshot of the message."
acceptanceCriteria:
  - "The refusal hint names the dashboard's Plan page Inbox, rex change place and MCP place_change"
  - "The hint mentions --propose for a change with no fitting home"
  - "v2-inbox-refusal.test.ts asserts the new wording"
priority: "medium"
tags:
  - "inbox-placement"
  - "hench"
source: "ndx-capture"
---
