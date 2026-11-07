---
id: "bd3a071a-6ad5-402d-9ae8-b872bd1969ed"
type: "task"
title: "An ask_choice card lets the agent ask a question with options the user picks"
slug: "an-ask-choice-card-lets-the-agent-ask"
description: "An agent's \"pick A, B or C\" arrives as plain transcript text and the user must type the answer; Claude's built-in tools are limited to Read, Grep and Glob plus the broker (server/sidecar/spawn-policy.ts:8-12,44,109). Add a broker tool ask_choice {question, options[{label, description?}], multiSelect?} rendered as a card with radio (or checkbox) rows, a selected state, arrow-key movement, an Other free-text row, and a Send button; the answer returns to the agent as the tool result. It writes nothing, so it needs no approval policy beyond answering. Tell the lenses (lens-instructions.ts) to use it for decisions. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites (architecture-policy, domain-isolation, shell-spawn inventory, wall-clock inventory, layout-literal, obfuscated-code) before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "ask_choice renders options with a selected state and keyboard selection, and the answer reaches the agent (viewer and web tests)"
  - "Other sends free text (viewer test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
