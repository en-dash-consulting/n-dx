---
id: "613fc6f0-e46a-4278-bf2e-9dbe2263ecf2"
type: "task"
title: "Workflow settings hold the Sidecar allow-list, mode, ceilings and idle window"
slug: "workflow-settings-hold-the-sidecar"
description: "Story 15 (CAOS https://www.notion.so/3f7a80b71924816398f4d93e0d38edd2), UX9': a Sidecar section on Settings > Workflow drawn as field cards like the rest of that page, not a tab, shown only while web.sidecar is on. Fields: the allow-list editor over the broker's allow-list file (broker.allowList()); rows for work, reset and push are shown locked and can never be added (broker-policy already refuses them). Mode: Ask, with Auto shown locked as not available yet. Context ceilings: web.sidecarContextCeiling.worktree (default 100000) and .hub (default 40000), read by sidecar/context-refresh.ts. Idle window: the session TTL (default 2 h, DEFAULT_SIDECAR_TTL_MS in sidecar/session-registry.ts), which needs a config key the registry reads. A GitHub reads toggle is stored for batch L2 and read by nothing yet. Nothing is written until an explicit Save. Mock: Settings board."
acceptanceCriteria:
  - "Settings > Workflow shows a Sidecar section in field cards only while web.sidecar is on (tested)"
  - "The allow-list editor lists, adds and removes rules in the broker's allow-list file, and work, reset and push rows show locked and cannot be added (tested)"
  - "Mode shows Ask, with Auto shown locked (tested)"
  - "The worktree and hub context ceilings (defaults 100000 and 40000) and the idle window (default 2 h) are editable, and context refresh and the session registry use the saved values (tested)"
  - "A GitHub reads toggle is saved, and nothing reads it yet (inspected)"
  - "Nothing is written until Save, and Save refuses an invalid value with a message (tested)"
priority: "medium"
source: "caos"
---
