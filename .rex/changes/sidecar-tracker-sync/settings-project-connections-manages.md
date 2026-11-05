---
id: "920b0ec3-0de3-4197-941a-89a90608ef74"
type: "task"
title: "Settings > Project > Connections manages MCP servers, policies, profiles and sync rules"
slug: "settings-project-connections-manages"
description: "Story 47 (CAOS 3f7a80b7-1924-810a-a352-f54b4bbead6e). Extend C1's read-only Connections section into the full page (packages/web/src/viewer/views/connections.ts, shown from Settings > Project; routes in src/server/routes-connections.ts; mock board 'Connections'): add-server form for HTTP (url) or stdio (command, args, env names and literal values) with auth none / token / OAuth and a Test button (connect + tools/list); a token is entered into the credential store through an authenticated route that writes connection:<id> and never echoes it; remove (also offers to delete connection:<id>); discovered tools listed with class and policy, each editable; profile picker with its validation result; rule toggles per event (off / dry-run / on) with the dry-run switch. Writes go to .n-dx.local.json only, through the dashboard's existing config write path. Only shown while web.sidecar is on. Check dark and light themes. Follow the shared rules in the parent change's description."
acceptanceCriteria:
  - "Adding an HTTP and a stdio fake server through the form writes .n-dx.local.json (never .n-dx.json) and Test lists their tools (tests)"
  - "A token typed into the form lands in connection:<id> of a temp-home store and is never returned by any route or written to a project file (test)"
  - "Each tool's class and policy can be changed and the change reaches the broker's tools/list (test)"
  - "Rule toggles write trackerSync rules and the profile picker shows the profile's validation result (viewer tests)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "caos"
---
