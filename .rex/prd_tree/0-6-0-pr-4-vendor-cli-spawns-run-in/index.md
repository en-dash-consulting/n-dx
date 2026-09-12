---
id: "24a10711-0364-43ac-a1f1-a6a2bfff9b27"
level: "epic"
title: "0.6.0 / PR 4 · Vendor CLI spawns run in the project directory"
status: "completed"
priority: "high"
tags:
  - "parallel-dev"
  - "release-0.6.0"
  - "pr-04"
  - "llm-client"
  - "web"
source: "parallel-development roadmap, 2026-09-10 discovery session"
startedAt: "2026-09-11T18:21:15.533Z"
completedAt: "2026-09-11T19:08:53.255Z"
endedAt: "2026-09-11T19:08:53.255Z"
acceptanceCriteria:
  - "Every vendor CLI spawn made on behalf of a project runs with cwd = that project's directory."
  - "Unit test asserts the cwd option on the spawn."
description: "Release 0.6.0 (minor) · PR 4 of 7 · packages: @n-dx/llm-client, @n-dx/web · changeset: patch.\n\nProblem. packages/llm-client/src/cli-provider.ts (~line 139) spawns the vendor CLI (claude / codex) with spawnCli(binary, args, { stdio, env }) and no cwd, so the child inherits the server process's working directory. The dashboard's Ask panel (packages/web/src/server/routes-sourcevision-ask.ts, createLLMClient at ~line 721) therefore runs the model CLI wherever `ndx start` was launched, not in ctx.projectDir. Harmless with one checkout; wrong the moment one server serves several.\n\nRun this epic in one session: `ndx work --auto --loop --epic=<this epic id> .`\nConventions for this work (apply to every task in this epic):\n- Cross-package imports go through the gateway modules (hench: src/prd/rex-gateway.ts, src/prd/llm-gateway.ts; web: src/server/rex-gateway.ts, domain-gateway.ts). Never import node:child_process in hench or web; use the exec helpers from @n-dx/llm-client (tests/e2e/architecture-policy.test.js enforces this).\n- Add a changeset with the SCOPED package names (@n-dx/core, @n-dx/web, ...). Bump level is stated per epic; default is patch.\n- Run the full root suite (pnpm test) before declaring done; the required tests are tests/e2e/cli-dev.test.js and tests/integration/scheduler-startup.test.js.\n- Do not run `ndx start` from a second checkout while another dashboard is up until PR 1 has merged: today it SIGKILLs the other server. Use --port=<free> if you must."
lastModified: "2026-09-11T19:08:53.262Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [createLLMClient and cli-provider accept a cwd and the Ask route passes ctx.projectDir](./createllmclient-and-cli-provider.md) | completed |
| [rex and sourcevision still spawn the vendor CLI without a cwd](./rex-and-sourcevision-still-spawn-the.md) | completed |
