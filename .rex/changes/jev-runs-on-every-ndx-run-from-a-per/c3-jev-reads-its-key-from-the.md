---
id: "12d277fe-4308-47dd-9a3e-9634d4b829f6"
type: "task"
title: "C3: Jev reads its key from the credential resolver"
slug: "c3-jev-reads-its-key-from-the"
description: "PR 1. Move every Jev key read from process.env to resolveCredential(\"typesafe\") (env first, then store), so MCP servers inside a hench run, the hub and a fresh shell all find the key while #817's child-env filter stays strict. Sites: llm-client config.ts resolveJudgmentRoute, jev-client.ts askJev, sourcevision analyzers/claude-client.ts probe (fake env), classify.ts auth message, sourcevision cli/help.ts, rex cli/commands/migrate-plan.ts jevAvailable, rex core/placement-policy.ts and migrations/v1-to-v2/seams.ts warnings, README.md guard.env.allow paragraph (~498-505). prd.place.judge and prd.migrate.judge stay opt-in, never default judgment routes."
acceptanceCriteria:
  - "resolveJudgmentRoute gates on resolveCredential(typesafe) and askJev takes its key the same way; injected env still works for tests"
  - "sourcevision claude-client.ts no longer probes with a fake env, and its fallback notice names ndx config credentials.typesafe"
  - "migrate-plan.ts computes jevAvailable from the resolver; placement-policy.ts and seams.ts warnings, classify.ts auth message and sourcevision help name the store command"
  - "prd.place.judge and prd.migrate.judge are still absent from DEFAULT_JUDGMENT_ROUTES (assertion)"
  - "With an empty env and a temp store holding a placeholder, resolveJudgmentRoute(code.classify) returns typesafe and askJev (mocked fetch) sends that placeholder; with a different placeholder in env, env's is sent"
  - "A vendor CLI child env still carries no TYPESAFE_API_KEY and no stored value appears in any child env (test)"
  - "The README paragraph advising guard.env.allow for TypeSafe is replaced with ndx config credentials.typesafe"
priority: "high"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
blockedBy:
  - "2f5ce643-1c49-4c70-ab2c-545f956873df"
---
