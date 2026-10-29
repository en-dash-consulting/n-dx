---
id: "bd2de5f5-875d-4f08-a494-0ba0d601a5c3"
type: "change"
title: "The dashboard never spawns a rex, sourcevision or hench binary the repository ships"
slug: "the-dashboard-never-spawns-a-rex"
intent: "Whole-stack adversarial re-review of #816 + #817 (diff mode, origin/main...fix/security-child-env at abf90b308), 2026-10-28, finding G (high, should-fix; out-of-scope (pre-existing), its own change; related to 44bea9a4 (resolveNdxBin), which is about correctness rather than trust).\n\nFailure scenario: packages/web/src/server/routes-commands.ts:198 resolveNdxCli puts the project's node_modules/.bin first (behind resolveRexBin and resolveSvBin), with a <projectDir>/packages/*/dist fallback; routes-rex-analysis.ts:61 and routes-rex/execution.ts:139 use it. A cloned repository that ships node_modules/.bin/rex gets it run, with the full parent environment, when the operator clicks Recommend, Analyze or epic execution on the dashboard. No trust gate is consulted.\n\nProbed: handleCommandsRoute POST /api/commands/recommend → 202 and the planted rex wrote its marker; trust state baseline.\n\nOptions: resolve the CLIs from the server's own module graph first and drop the project-local rungs (the dogfood path only when the project is the n-dx monorepo itself, decided by package identity, not path); or gate the project-local rungs on trust. Pass a sanitized env either way. Recommended: module graph first, no project-local rung."
acceptanceCriteria:
  - "No dashboard route spawns a binary resolved from the project's node_modules or packages/ directories while the checkout is untrusted"
  - "Test: a fixture project with a planted node_modules/.bin/rex does not run it from POST /api/commands/recommend; the test fails on the code before the fix"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "high"
discoveredFrom: {"item":"82468601-c666-4943-a9ac-b11bb0149372"}
tags:
  - "security"
  - "issue-cleanup"
  - "ndx-adversarial-review"
  - "severity:high"
source: "ndx-adversarial-review"
---
