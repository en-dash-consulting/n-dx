---
id: "250e6c57-54a5-4d31-815c-720ea268e972"
type: "task"
title: "C1a: every suite that can reach the resolver gets a temp ndx home with Jev's env cleared"
slug: "c1a-every-suite-that-can-reach-the"
description: "PR 1. Wire tests/setup-ndx-home.js (temp N_DX_HOME, NDX_HOME cleared) and tests/setup-judgment-env.js (deletes TYPESAFE_API_KEY) into every vitest suite that can reach @n-dx/llm-client's resolver, before any code reads a credential store. Today: setup-ndx-home is in root, web and sourcevision (own copy) only; setup-judgment-env is in llm-client and sourcevision only. Add a policy test so a new package cannot drop either. Use resolveLayout/resolveNdxHome, never hand-spelled .ndx/.rex/.hench paths."
acceptanceCriteria:
  - "tests/setup-ndx-home.js is in setupFiles of the llm-client, rex, hench and graview vitest configs (root, web and sourcevision already have it)"
  - "tests/setup-judgment-env.js is in setupFiles of the root, web, rex, hench and graview vitest configs (llm-client and sourcevision already have it)"
  - "A policy test fails any packages/*/vitest.config.* whose package depends on @n-dx/llm-client but lacks either setup file, naming the package"
  - "The full llm-client, rex, hench and graview suites and the root suite pass"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
---
