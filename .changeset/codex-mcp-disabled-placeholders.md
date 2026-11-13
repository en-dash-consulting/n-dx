---
"@n-dx/llm-client": patch
"@n-dx/web": patch
---

Codex Sidecar (experimental, off by default; enable with `web.sidecar`) uses complete disabled entries for project MCP servers so turns can load their configuration.

Each project MCP server except `ndx-sidecar` is turned off with `enabled=false` plus a placeholder matching its declared transport: `command="ndx-sidecar-disabled"` for stdio or `url="http://127.0.0.1:9/ndx-sidecar-disabled"` for HTTP. The entry is valid whether or not Codex loads the project `.codex/config.toml`; a server declaring neither or both transports refuses the turn. A turn that still reaches an MCP server other than `ndx-sidecar` is stopped, and the reason is shown.

Action needed: If a turn refuses an ambiguous transport, edit the named `.codex/config.toml` so each server declares exactly one `command` or `url`.

The original codex-cli `0.166.0` report showed that `--ignore-user-config` skips the project config and an `enabled=false` override alone fails transport validation. Final broker behavior on `0.166.0` and `0.164.0-alpha.11.1` remains unverified here; parser and scripted argv tests do not establish live CLI compatibility.
