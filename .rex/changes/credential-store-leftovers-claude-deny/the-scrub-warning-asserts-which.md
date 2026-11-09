---
id: "a10f7f31-5218-41df-bb48-9d02da2bbad0"
type: "task"
title: "The scrub warning asserts which variables Claude Code removes without checking Claude Code's real scrub set"
slug: "the-scrub-warning-asserts-which"
description: "Adversarial review of 03dd62b9 (verdict: should-fix, low).\n\nFailure scenario: scrubbedAllowedNames (packages/llm-client/src/child-env.ts) uses n-dx's DEFAULT_ENV_DENY as a stand-in for what CLAUDE_CODE_SUBPROCESS_ENV_SCRUB removes. Claude Code's docs describe the scrub as removing Anthropic and cloud-provider credentials; if that is the whole set, an allowed DB_PASSWORD still reaches the agent's Bash commands and the run-log line (\"they will not see DB_PASSWORD\", packages/hench/src/store/project-config.ts cliEnvReportLine) is false. If the scrub is wider than the deny list, a name it removes goes unreported. Neither direction was verified on a real Claude CLI run.\n\nReachable: ndx work, claude cli loop, llm.claude.auth api (or configured api_key under auto) plus a hench.guard.env.allow entry.\n\nOptions: (1, recommended) run a Claude CLI session with the scrub on and an allowed DB_PASSWORD / DATABASE_URL / NPM_TOKEN, record what `env` shows inside Bash, and align the list (or narrow the warning to \"may not see\") from that evidence; (2) soften the wording to \"may not see\" now without checking. Cheap either way."
acceptanceCriteria:
  - "A recorded Claude CLI run with CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1 shows which of DB_PASSWORD, DATABASE_URL, NPM_TOKEN and GITHUB_TOKEN a Bash command sees, cited next to scrubbedAllowedNames"
  - "The scrubbed warning names exactly the allowed variables that run shows removed, or its wording no longer claims removal for names the run shows kept"
  - "docs/guide/configuration.md describes the scrub set from that evidence"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "credential-store"
  - "llm-client"
  - "hench"
source: "ndx-adversarial-review"
---
