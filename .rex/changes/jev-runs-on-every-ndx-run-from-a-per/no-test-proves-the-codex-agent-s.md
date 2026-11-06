---
id: "054e2c9c-61a9-4ab8-9fb6-908f29fba024"
type: "task"
title: "No test proves the Codex agent's commands see OPENAI_API_KEY empty; the Codex shell_environment_policy semantics the fix relies on are unverified"
slug: "no-test-proves-the-codex-agent-s"
description: "Verdict: should-fix (adversarial review of db3c0066). The fix (packages/llm-client/src/codex-cli-provider.ts codexShellEnvFlags) passes `-c shell_environment_policy.set.<NAME>=''` on every codex exec, and docs/guide/configuration.md states as fact that `set` runs after the policy's filters and that a dotted -c path replaces only that one `set` entry. Neither was verified: the Codex docs fetch (https://developers.openai.com/codex/config-advanced) and running the local codex binary both needed approval during db3c0066. The only Codex-side check, packages/hench/tests/integration/codex-flag-surface.test.ts, runs `codex exec --strict-config -c <override>`, which proves Codex accepts the key, not that a spawned command's environment carries an empty value.\n\nFailure scenarios if the recalled semantics are wrong: (a) a dotted `-c shell_environment_policy.set.OPENAI_API_KEY=''` replaces the user's whole `set` table, so their own `set` entries (e.g. CI=1) silently vanish from every agent command; (b) Codex builds the command env in an order where an inherited value overwrites `set`, so the key still reaches the command. Reachable on every `ndx work` Codex CLI run.\n\nOptions: (1) read the Codex docs/source and record the evidence in the codexShellEnvFlags comment and the docs paragraph — cheap, no runtime risk; (2) add a codex-present (skipIf !codex) test that runs a command under Codex's policy without reaching the model (e.g. `codex sandbox`/`codex debug` subcommands if they apply shell_environment_policy) and asserts `OPENAI_API_KEY` is empty and a user `set` entry survives — stronger, depends on a model-free Codex entry point existing. Recommend (1) now, (2) if such an entry point exists."
acceptanceCriteria:
  - "The codexShellEnvFlags comment and docs/guide/configuration.md cite the Codex documentation or source that confirms the order inherit → default excludes → exclude → set → include_only and that a dotted -c override of one set entry keeps the user's other set entries"
  - "Where codex is installed, a test asserts that a command run under the spawned codex's shell_environment_policy sees OPENAI_API_KEY as empty while a user-config set entry is still present, or the item records why no model-free Codex entry point allows such a test"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "credential-store"
  - "security"
  - "llm-client"
source: "ndx-adversarial-review"
---
