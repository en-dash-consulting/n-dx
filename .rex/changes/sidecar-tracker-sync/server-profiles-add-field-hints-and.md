---
id: "6aa7f142-e208-405d-98a8-e4cebb8f8c79"
type: "task"
title: "Server profiles add field hints and tracker mappings, with CAOS built in"
slug: "server-profiles-add-field-hints-and"
description: "Story 48 (CAOS 3f7a80b7-1924-8194-8d5c-c046d3a68c0a). A profile is a JSON data file per server: fieldHints (per tool and property, the same FieldHint shape as C1's per-connection fieldHints, which still win over the profile's for the same property) and an optional tracker mapping (createTool, moveTool, readTool, statusMap ndx event → tracker status for every event in the rule set, facts each event needs and where they come from, defaults: reviewer, estimate scale). Built-in profiles ship in packages/web/src/server/tracker/profiles/ with CAOS first (create_work_item, edit_work_item, move_work_item, get_work_item, list_epics, get_creation_options; epic picker from list_epics, enums from get_creation_options, requestId auto). Users add their own under <ndx home>/tracker-profiles/. A connection names its profile in config. Profiles are validated on load against the connected server's tools/list: every referenced tool exists and every status map covers every event; an invalid profile is reported on the connection and not used, and the connection still works attended. Follow the shared rules in the parent change's description."
acceptanceCriteria:
  - "The built-in CAOS profile validates against a fake server exposing CAOS's tool names and schemas, and its hints make the external-call form show an epic picker from list_epics and enums from get_creation_options (tests with the fake server, never CAOS)"
  - "A profile naming a tool the server lacks, or a status map missing an event, is refused on load with a message naming the gap, and the connection keeps working attended (tests)"
  - "A server with no profile still lists, runs reads and raises plain write cards (test)"
  - "A user profile in a temp ndx home's tracker-profiles/ loads and overrides nothing built in by accident (same-name user profile wins only when named explicitly) (test)"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "caos"
---
