---
id: "fc02c0b7-84e9-4f2f-9bf0-62687ac0933b"
type: "change"
title: "Forward the user's Codex model provider into Sidecar turns through -c overrides"
slug: "forward-the-user-s-codex-model"
intent: "Follow-up to the #1008 review (Hal, 2026-11-09). Codex Sidecar sessions now refuse when the user's ~/.codex/config.toml selects a model provider other than openai, because `--ignore-user-config` drops `model_provider` and `[model_providers.*]`. The fuller fix forwards the selected provider through `-c`: `-c model_provider=<id>` plus `-c model_providers.<id>.<key>=<value>` for each key of its table (name, base_url, env_key, wire_api, query_params, http_headers and the rest), so Azure and other providers work in the Sidecar without loading the rest of the user's config. Needs verification on the real Codex CLI, and care that no forwarded value carries a credential into argv (env_key names a variable; http_headers values may be secrets, so use env_http_headers or refuse)."
acceptanceCriteria:
  - "An Azure-configured user's Codex Sidecar turns authenticate with the forwarded provider, verified on the real Codex CLI, with no credential in argv"
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "low"
source: "hub-pr3"
---
