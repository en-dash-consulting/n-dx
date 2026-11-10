---
id: "3dbce690-339a-44f9-8154-0db093b49be2"
type: "task"
title: "A refused Sidecar start reports hench's stdout refusal even when stderr has output"
slug: "a-refused-sidecar-start-reports-hench"
description: "PR review comment on #989 (packages/web/src/server/routes-hench.ts:2575): the execution's finish() passes `output: result.stderr?.trim() ? result.stderr : result.stdout`, but hench prints its pre-run refusals with info() (console.log, stdout) and warnings with warn() (stderr). On a dirty tree where hench also warns about a config field, stderr holds only the warning, so runFailedResult tells the agent and the card about the warning and the refusal with its file list never arrives. Send both streams (the tail of stderr, then the tail of stdout, each bounded) to the Sidecar's failure text and the execution log's detail, or make hench write its refusals to stderr — prefer the first, which keeps hench's output contract. Add a web test where the child writes a warning to stderr and the refusal to stdout and exits 1, and assert the card and the agent's tool result both carry the refusal. Shared rules: viewer code reaches messaging only through src/viewer/external.ts and src/viewer/api.ts and imports hooks and components through their barrels (tests/integration/boundary-check.test.ts); style only with tokens from styles/tokens.css in both themes; viewer copy names the CLI through useCliName() or a {cli} template with resolveCliLabel(), never a bare 'ndx <command>' (tests/unit/viewer/cli-name-labels.test.ts); do not edit packages/web/AGENTS.md or src/server/AGENTS.md; nothing turns on web.sidecar; run the static root policy suites before finishing; add a patch changeset per package touched."
acceptanceCriteria:
  - "With a stderr warning and a stdout refusal, the failed start's card and tool result carry the refusal and its file list (web test)"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
