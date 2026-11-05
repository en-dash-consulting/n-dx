---
id: "b59456bd-36ac-4409-9707-6f30c2844f89"
type: "task"
title: "External write calls raise a form card built from the tool's input schema"
slug: "external-write-calls-raise-a-form-card"
description: "Story 43 (CAOS 3f7a80b7-1924-8169-970d-d9029aff5e07). Replace the external-call card's JSON view with a form rendered from the tool's JSON input schema (string, number, integer, boolean, enum, arrays of scalars, nested objects one level; anything else falls back to a JSON field for that property), prefilled with the agent's arguments and editable before Approve; required fields marked; Approve sends the edited arguments. The card's header shows the connection label and the workspace (connection label + host, e.g. \"CAOS · caos.endash.us\") and, when the arguments carry an idempotency key (a property named requestId or idempotencyKey), shows it read-only. A field-hints hook (an optional per-connection map from property name to { optionsFrom: { tool, path } } read tools, or { auto: true }) fills a picker from a read tool's result; with no hints the plain form renders. Hints are exercised in tests with a fake server (CAOS's own hints ship with the profile in story 48). When the server's result is an error carrying a problems list (structured content or JSON text with problems[] / error: \"validation_failed\"), the result shows each problem and the session gets it as-is; nothing retries with altered arguments. Viewer code through src/viewer/external.ts and api.ts. Check dark and light themes. Follow the shared rules in the parent change's description (config only in .n-dx.local.json, tokens only from connection:<id> via connection-credentials.ts, no child env token, nothing tracker-specific, fake servers and a temp ndx home in tests, no AGENTS.md edits under packages/web, nothing turns on web.sidecar)."
acceptanceCriteria:
  - "An ask-policy write from a fake server raises a card whose form fields follow the input schema, with the agent's arguments prefilled; Approve sends the edited values (viewer and broker tests)"
  - "With no field hints the plain schema form renders; with a fake hint a property becomes a picker filled from the named read tool (tests)"
  - "The card shows the connection, the workspace host and a requestId or idempotencyKey argument read-only (viewer test)"
  - "A validation_failed result shows its problems list on the card and reaches the session unchanged, and no second call is made (test)"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "caos"
---
