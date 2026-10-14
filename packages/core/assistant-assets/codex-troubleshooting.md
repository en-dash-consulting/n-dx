## Codex Troubleshooting

Two failures are specific to running hench against the `codex` CLI. Both are
survivable — the run continues — so they show up as a wrong number or odd text
rather than an error.

### Malformed Codex output (parse fallback)

A summary that contains raw payload text, with `[Warn] Codex block missing
type` or `[Warn] Unknown Codex block type` on the run. `normalizeCodexResponse`
in `packages/hench/src/agent/lifecycle/cli-loop.ts` treats malformed JSON as
plain text rather than failing. If you wrap `codex exec`, give every block a
`type` and a text field (`text`, `content`, `delta` or `output_text`).

### Missing usage fields / token mismatch

`hench show` reports `0 in / 0 out` against a non-empty response.
`mapCodexUsageToTokenUsage` in `token-usage.ts` reads `input_tokens |
prompt_tokens | input` and the output and total equivalents; when none is
present it records zeros and the diagnostic key `codex_usage_missing`. The zero
is intentional — treat it as a data-quality signal from the wrapper.

Both have verify commands, expected strings and the suites that pin them in
[docs/guide/troubleshooting.md](docs/guide/troubleshooting.md).
