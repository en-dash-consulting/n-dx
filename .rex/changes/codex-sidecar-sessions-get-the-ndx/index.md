---
id: "84d07c33-0fb2-4a54-9e9b-88acd0abd9cb"
type: "change"
title: "Codex Sidecar sessions get the ndx-sidecar broker"
slug: "codex-sidecar-sessions-get-the-ndx"
intent: "Codex Sidecar sessions are refused today: CODEX_SIDECAR_UNAVAILABLE (packages/web/src/server/routes-sidecar.ts) refuses vendor codex at create and at every turn, on the belief that `codex exec resume` cannot take a sandbox or approval policy.\n\nA Codex session run against codex-cli 0.164.0-alpha.11.1 on 2026-11-06 proved that belief wrong. `exec resume` honours `-c sandbox_mode=...` and `-c approval_policy=...` (it rejects `--sandbox`): a first turn recorded workspace-write, the resumed turn recorded read-only, and a write on the resumed turn was denied. compileCodexPolicyFlags({resume: true}) in packages/llm-client/src/codex-cli-provider.ts sends only the shell-environment flags, so a resumed Codex turn runs under the user's ~/.codex/config.toml.\n\nCodex Sidecar turns also get no MCP server, so they cannot raise a card, and they would load the user's own config.toml MCP servers and the Apps integration. parseCodexJsonLine (packages/llm-client/src/vendor-session-driver.ts) ignores `mcp_tool_call` items, so broker calls from Codex would be invisible in the transcript.\n\nThis change parses those items, re-applies the policy on resume, wires the ndx-sidecar broker into every Codex Sidecar turn through `-c` flags (headers from the child's environment only, never argv), keeps user and project MCP servers out, and lifts the refusal. Hub sessions stay Claude-only.\n\nThe verified CLI facts and the verbatim --json event lines are in ~/ndx-core/local-design-workshop/docs/roadmap/sidecar-hub-2026-11-06/codex-answers.md (copied into the task descriptions). Only that alpha build is verified."
acceptanceCriteria:
  - "A Codex Sidecar session can be created and its resumed turns stay read-only, with no approval prompts."
  - "A Codex Sidecar turn sees only the ndx-sidecar MCP server, and no broker credential appears in its argv or its agent's shell environment."
  - "Verified live by Ryan, with the ChatGPT.app Codex binary, in a real n-dx checkout: the nine broker tools listed, and a write tool waiting on its card."
amends: [{"target":"c86273ce-88fd-465c-8a90-7de4fde389ad","delta":"modified","summary":"A resumed codex exec re-applies the policy with -c overrides","criteria":{"replace":[{"id":"c4","text":"When the codex CLI provider spawns codex exec resume, it shall re-apply the sandbox and approval policy with -c sandbox_mode= and -c approval_policy= overrides and pass no --sandbox flag."}]},"proposed":"When an autonomous codex run starts a fresh codex exec, the codex CLI provider passes only approval and sandbox policy flags that the installed codex exec accepts, so the run gets past argument parsing to the model call; a resumed codex exec re-applies the same policy with -c sandbox_mode= and -c approval_policy= overrides, since codex exec resume rejects --sandbox.","base":"5a9b5594532d60cd763038cc5270369a3b3ebe8e7543c32281ab08f556e0b888"}]
touches:
  - "a6a5ac6a-ca47-435e-8749-91505acad43f"
priority: "medium"
source: "hub-pr3"
---
