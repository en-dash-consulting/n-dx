---
id: "4df7a49b-1b9a-47f5-be5a-3ed4493a3974"
type: "task"
title: "Sidecar Markdown keeps a numbered list's start and renders indented sub-bullets as list items"
slug: "sidecar-markdown-keeps-a-numbered-list"
description: "PR review comment on #990 (packages/web/src/viewer/utils/markdown.ts:117): (1) <ol> gets no start, so `1. Install` / a code fence / `2. Run` renders as two lists both starting at 1 — common in LLM step-by-step replies. Pass start from the first item's number when it isn't 1. (2) List items only match at column 0, so `  - detail` ends the list and falls into a paragraph that shows a literal `- detail`. Accept leading whitespace in LIST_KINDS and in the paragraph-break test; flattening nesting into the same list is fine. The PR preview shares the renderer and must keep rendering as before for its inputs. Add tests for both shapes. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; viewer copy names the CLI through useCliName() or a {cli} template with resolveCliLabel(), never a bare 'ndx <command>' (tests/unit/viewer/cli-name-labels.test.ts); do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "A numbered list split by a code fence continues its numbering (viewer test)"
  - "Indented sub-bullets render as list items, not literal text (viewer test)"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
