---
id: "5075f653-b1ee-41cd-a696-7bbaf4de1469"
type: "task"
title: "External tools carry a read/write class and a run/ask/never policy"
slug: "external-tools-carry-a-read-write"
description: "Story 42 (CAOS 3f7a80b7-1924-81f7-ad52-e6a9e7739ce4). A pure module (packages/web/src/server/connections/tool-policy.ts) that classifies each discovered tool: read when annotations.readOnlyHint is true; write otherwise (destructiveHint true, or no annotation: unannotated tools err toward write). Per-tool operator overrides in the connection's config: tools: { \"<tool>\": { class?: \"read\" | \"write\", policy?: \"run\" | \"ask\" | \"never\" } }. Default policy: read -> run, write -> ask. \"run\" on a write is allowed only by an explicit override. Exposed through the connection service's tool list (class, policy, and whether each came from annotation, default or override). Follow the shared rules in the parent change's description (config only in .n-dx.local.json, tokens only from connection:<id> via connection-credentials.ts, no child env token, nothing tracker-specific, fake servers and a temp ndx home in tests, no AGENTS.md edits under packages/web, nothing turns on web.sidecar)."
acceptanceCriteria:
  - "readOnlyHint true classifies read; destructiveHint true or no annotation classifies write; an operator class override wins and is reported as an override (unit tests)"
  - "Defaults are read -> run and write -> ask; a per-tool policy override (run, ask, never) is honoured (unit tests)"
  - "An invalid override (unknown class or policy, or a tool the server does not list) is ignored with a warning naming it, never a crash (test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "caos"
---
