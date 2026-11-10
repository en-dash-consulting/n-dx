---
id: "03dd62b9-6298-4938-b35e-70e3394c6b28"
type: "task"
title: "The Claude subprocess scrub silently drops credentials guard.env allows to the agent's commands"
slug: "the-claude-subprocess-scrub-silently"
description: "Adversarial review of 82ff7e46 (verdict: should-fix, medium).\n\nFailure scenario: a project runs Claude with llm.claude.auth api (or a configured llm.claude.api_key under auto) and allows DB_PASSWORD (or NPM_TOKEN, a DATABASE_URL with a password…) through hench.guard.env.allow so the agent's integration tests can reach a database. Since 82ff7e46, resolveVendorCliEnv (packages/llm-client/src/child-env.ts, setKey → scrubAgentSubprocesses) sets CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1, and Claude Code removes every credential-looking variable from the agent's Bash commands, not only ANTHROPIC_API_KEY. The agent's `pnpm test` goes red for a missing variable while hench's own test gate (spawned by hench, not Claude) still has it and goes green. Nothing at run time says why; only docs/guide/configuration.md mentions it.\n\nReachable: ndx work on any claude cli-loop run with auth api and a guard.env allow entry shaped like a credential.\n\nOptions:\n1. (Recommended) When the scrub is on and guard.env.allow names a variable that Claude's scrub would remove, print one warning line through the existing onStripped/cliEnvReportLine channel naming the variables (names only). Cheap; keeps the security default.\n2. Add an opt-out (e.g. hench.scrubAgentEnv: false, user-local config only so a repository cannot widen it), with the warning. More surface; needs trust handling.\n3. Do nothing beyond docs. Leaves the confusing red/green split."
acceptanceCriteria:
  - "A claude CLI run with the scrub on and a credential-shaped guard.env.allow entry reports, by name only, that the agent's commands will not see that variable"
  - "Test: resolveVendorCliEnv (or hench's cli-loop report) emits the warning for DB_PASSWORD allowed under auth api and stays silent under auth cli; it fails on the code before the fix"
  - "docs/guide/configuration.md names the warning and any escape hatch"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "credential-store"
  - "llm-client"
  - "hench"
source: "ndx-adversarial-review"
---
