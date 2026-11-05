---
id: "99e2bdb7-df41-4278-8cf7-c20b1776935c"
type: "task"
title: "A tool line whose call failed reads Failed, not Done"
slug: "a-tool-line-whose-call-failed-reads"
description: "Found by the review of P3 (run fe188d11), dropped there as not-worth-fixing; kept because the drawer now speaks to non-developers. A tool call whose result is an error (the frame's is_error / isError, or a broker refusal text) with no card reads 'Done' in the plain-language pill (packages/web/src/viewer/components/sidecar-drawer.ts, sidecar-tool-names.ts). It should read 'Failed' with the failed dot, keeping the details expandable. Follow the shared rules in the parent change's description."
acceptanceCriteria:
  - "A tool frame whose result is an error, with no card, renders its pill as Failed with the failed status dot (viewer test)"
  - "A successful call still reads Done, and a call waiting on a card still reads Waiting for you (existing tests pass)"
priority: "low"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
