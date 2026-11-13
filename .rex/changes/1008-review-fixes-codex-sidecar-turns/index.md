---
id: "49104d5b-f333-4685-82b0-51a1ad8e402f"
type: "change"
title: "#1008 review fixes: Codex Sidecar turns start in an ndx init'd repo and refuse a non-default model provider"
slug: "1008-review-fixes-codex-sidecar-turns"
intent: "Review of #1008 by Hal (2026-11-09), two inline comments on packages/web/src/server/sidecar/spawn-policy.ts.\n\n1. (line 192) On codex-cli 0.166.0, `--ignore-user-config` also keeps the project `.codex/config.toml` from loading: project config is honoured only for projects the user config trusts. So `-c mcp_servers.rex.enabled=false` creates a server entry with no command or url, and Codex exits 1 with `Error loading config.toml: invalid transport in mcp_servers.rex`. That breaks every Codex Sidecar turn in an `ndx init`'d repo. The spawn-policy tests assert the flags, so they could not catch it. Whether 0.164.0-alpha.11.1 (the ChatGPT.app build the PR was verified on) loads project config under `--ignore-user-config` was never tested.\n\n2. (line 165) `--ignore-user-config` skips the whole `~/.codex/config.toml`, so `model_provider` and its `[model_providers.*]` table go too. n-dx supports that setup on purpose (`codexUserEnvKey` forwards the provider's `env_key`, e.g. AZURE_OPENAI_API_KEY), but under this flag Codex falls back to the OpenAI provider, so an Azure-only user's Sidecar turns all fail auth and may be shown as signed out.\n\nThis change fixes both so they hold on 0.164 and 0.166. Forwarding the provider through `-c` is a separate, later capture."
acceptanceCriteria:
  - "A Codex Sidecar turn's config overrides are valid whether or not Codex loads the project .codex/config.toml, on codex-cli 0.164.0-alpha.11.1 and 0.166.0 alike."
  - "A Codex Sidecar session whose user Codex config selects a non-default model provider is refused up front with a clear reason, not left to fail auth."
  - "Verified live by Ryan or Hal on codex-cli 0.166.0 in an ndx init'd checkout: a Codex Sidecar turn starts and lists only the ndx-sidecar tools."
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "high"
source: "hub-pr3"
---
