---
id: "e526d2d3-0aee-4863-986e-0d596644be76"
level: "feature"
title: "Adversarial security review 2026-09-11 — findings"
status: "pending"
priority: "critical"
tags:
  - "security"
  - "ndx-adversarial-review"
source: "ndx-adversarial-review"
acceptanceCriteria: []
description: "Findings from a whole-repo adversarial security review (2026-09-11, `/ndx-adversarial-review`, security focus). Scope: every runtime path in `packages/*` that executes commands, touches files from user-influenced paths, serves HTTP, sends data off-machine, or persists secrets.\n\nGround truth at review time: `packages/web/tests/unit/request-security.test.ts` 10/10 green; `packages/hench/tests/unit/guard` 99/99 green. Neither suite covers the WebSocket upgrade path or the newline/redirect/git-args bypasses — that gap is why findings 3, 4, 5 survived.\n\nAttacked and found sound (no item filed): loopback bind; Origin + Sec-Fetch-Site guard on mutating routes and MCP (compares socket port, not Host — DNS-rebinding safe); run-id/task-id → file/argv (regex + PRD lookup); static/data path traversal; bundle-import slugs; adapter-token redaction (env-var indirection, never returned raw); viewer HTML sinks (all escaped — no XSS primary found); Windows cmd.exe quoting; CLI invocation-log redaction; `.hench/runs/` gitignored by `hench init`; destructive git discard gated by `confirmCount`.\n\nAccepted risks noted, not filed: repo-tracked config drives execution (`.rex/config.json` testCommand via `verify_criteria` with `runTests` defaulting true; `.hench/config.json` allowlist); `npx` / `node -e` in the default allowlist make it advisory; spawned agents inherit full `process.env`; `bypassPermissions` is a supported value. Candidate for a \"Threat model\" docs section.\n\nEach child task carries the failure scenario, `file:line` evidence, reachability, and solution options with a recommendation. Tasks are independent — no ordering."
lastModified: "2026-09-11T17:36:17.096Z"
lastModifiedBy: "sterling.h@endash.us <sterling.h@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [`/api/workflow/apply-suggestion` writes arbitrary dotted keys into `.hench/config.json`](./api-workflow-apply-suggestion-writes.md) | pending |
| [Gemini provider sends the API key in the URL query string](./gemini-provider-sends-the-api-key-in.md) | pending |
| [hench command guard passes newline-separated commands and `>` redirection](./hench-command-guard-passes-newline.md) | completed |
| [hench `git` tool re-joins args into `sh -c` with no shell-operator check](./hench-git-tool-re-joins-args-into-sh-c.md) | completed |
| [`.n-dx.json` receives API keys but `ndx init` never gitignores it](./n-dx-json-receives-api-keys-but-ndx.md) | completed |
| [`ndx export` / `--deploy=github` publish full hench transcripts with no redaction or confirmation](./ndx-export-deploy-github-publish-full.md) | completed |
| [Web server `readBody` has no request-size cap](./web-server-readbody-has-no-request.md) | pending |
| [WebSocket upgrade accepts any Origin — dashboard broadcasts readable cross-site](./websocket-upgrade-accepts-any-origin.md) | pending |
