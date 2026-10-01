---
"@n-dx/web": patch
---

`GET /api/llm/catalog` serves a live model list, the installed CLI version and each vendor's default model.

Each vendor entry gains `source` (`"live"` or `"built-in"`), `checkedAt` and,
for the built-in list, a `reason`; `defaultModel` is what `ndx work` runs with
no `hench.models.<vendor>` set. The claude and codex entries list from the
vendor's Models API when a key resolves, and fall back to the built-in list
with no key, on error or after 5s, so the route never fails because of it.
They also gain `cli: { found, version, path }` from `<binary> --version`,
resolving the binary as runs do (`CLAUDE_CLI_PATH`, `cli.claudePath`,
`llm.codex.cli_path`, including `.n-dx.local.json`).

Results are cached per vendor for 10 minutes. `?refresh=true` refills the
cache and a successful `PUT /api/llm/config` clears it.
