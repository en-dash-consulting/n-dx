---
id: "bd53209a-99f9-4ad6-863d-7512e66a1c2e"
type: "task"
title: "Codex agent commands lose a user-exported OPENAI_API_KEY under auth cli and auto, unlike Claude, with no way to opt out"
slug: "codex-agent-commands-lose-a-user"
description: "Verdict: should-fix, a decision for the maintainer (adversarial review of db3c0066). codexShellEnvFlags (packages/llm-client/src/codex-cli-provider.ts) is added to every codex exec in every auth mode, so a key the user exported themselves is blanked in the agent's commands too. Claude does the opposite: child-env.ts sets CLAUDE_CODE_SUBPROCESS_ENV_SCRUB only when n-dx set the key, and the docs say an exported key under auto passes through unscrubbed. The task's done-when only required blanking under llm.codex.auth api.\n\nScenario: llm.codex.auth cli, user exports OPENAI_API_KEY for their app's integration tests, `ndx work` asks the Codex agent to run them → the command sees OPENAI_API_KEY=\"\" (present but empty, not unset), so the tests fail with an auth error the agent then tries to \"fix\". hench's own test gate still sees the key, so the run may pass the gate while the agent wasted turns. Before the change, whether the command saw the key depended on the user's Codex shell_environment_policy.\n\nOptions: (1) keep it and document it as intended (security-first, matches the \"no opt-out\" Claude stance) — no code; (2) pass the flags only when resolveVendorCliEnv set the key (needs that fact carried from the env resolver to the arg builders: hench adapter, provider, core reviewer/preflight) — moderate cost, matches Claude; (3) keep blanking but omit names absent from the child env so \"unset\" stays unset — cheap, but `set` cannot unset, so only partially helps. Recommend deciding between (1) and (2)."
acceptanceCriteria:
  - "docs/guide/configuration.md and the codexShellEnvFlags comment state whether an exported Codex key reaches the agent's commands under auth cli and auto, and the behaviour matches the statement"
  - "If the decision is to match Claude: under llm.codex.auth cli, or auto with no configured key, a codex exec spawn carries no shell_environment_policy.set override for OPENAI_API_KEY, with a test that fails on the current code"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "credential-store"
  - "llm-client"
source: "ndx-adversarial-review"
---
