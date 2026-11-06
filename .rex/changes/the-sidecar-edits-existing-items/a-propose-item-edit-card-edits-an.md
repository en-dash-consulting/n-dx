---
id: "8334c419-88f6-4cc6-90d1-b22c88dc06fd"
type: "task"
title: "A propose_item_edit card edits an existing item's title, description, criteria, tags and priority after approval"
slug: "a-propose-item-edit-card-edits-an"
description: "Add a broker tool propose_item_edit {id, title?, description?, acceptanceCriteria?, tags?, priority?} that wraps rex edit_item semantics (packages/rex/src/cli/mcp-tools/edit-item.ts:19-22,128-136) through the web rex gateway. Policy always-ask. Wire it through BROKER_TOOL_NAMES and BROKER_TOOL_POLICY (packages/web/src/server/sidecar/broker-policy.ts:19-32,79-96), CARD_TOOLS and the schema (broker-mcp.ts:59-200), carry-out (carry-out.ts:150-215), SidecarActions and routes-sidecar.ts. The card shows a before/after diff per field and lets the operator edit the proposed values before approving. Update lens-instructions.ts:111 so Describe proposes criteria edits with this card. Gateway exports stay within their ceiling; if a new export is needed, check docs/architecture/gateways.md and prefer sending computed data from the server. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "Approving a propose_item_edit card writes the edited fields, including tags and acceptance criteria (web test)"
  - "Rejecting it writes nothing (web test)"
  - "The Describe lens instructions offer the edit card (web test)"
priority: "medium"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
