## Codex Troubleshooting

### 1) Malformed Codex output (parse fallback)

Symptoms:
- Task run does not crash, but summary contains raw payload text.
- Warnings appear for missing/unknown block types.

Verify:
```sh
rg -n "normalizeCodexResponse|Codex block missing type|Unknown Codex block type" packages/hench/src/agent/lifecycle/cli-loop.ts
```
Expected:
- Matches exist for `normalizeCodexResponse`.
- Warning strings are present: `Codex block missing type; ignoring block.` and `Unknown Codex block type "..."`

```sh
pnpm --filter hench exec vitest run tests/unit/agent/codex-normalization.test.ts
```
Expected:
- Test names include `truncated JSON payload falls back to plain text` and `applies deterministic fallback behavior for malformed fixtures`.
- Suite passes without throwing on malformed payloads.

Operational signal during a run:
- `[Warn] Codex block missing type; ignoring block.`
- `[Warn] Unknown Codex block type "<type>" ignored.`

Remediation:
- If you wrap `codex exec`, ensure blocks include a `type` and text fields (`text`, `content`, `delta`, or `output_text`).
- Plain text output is supported; malformed JSON is treated as plain text fallback.

### 2) Missing usage fields / token mismatch in Codex mode

Symptoms:
- `hench show` reports `0 in / 0 out` despite a non-empty response.
- Token budget behavior looks lower than expected for that turn.

Verify:
```sh
rg -n "mapCodexUsageToTokenUsage|codex_usage_missing|input_tokens|prompt_tokens|completion_tokens|total_tokens" packages/hench/src/agent/lifecycle/token-usage.ts packages/hench/src/agent/lifecycle/cli-loop.ts
```
Expected:
- Mapping exists for:
  - input: `input_tokens | prompt_tokens | input`
  - output: `output_tokens | completion_tokens | output`
  - total: `total_tokens | total` (fallback to `input + output`)
- Diagnostic key `codex_usage_missing` is present.
- Warning text exists: `Codex response omitted usage; token accounting defaulted to zero.`

```sh
pnpm --filter hench exec vitest run tests/unit/agent/token-usage.test.ts
```
Expected:
- `mapCodexUsageToTokenUsage` cases pass, including:
  - nested `response.usage` mapping
  - zeroed usage with `codex_usage_missing` when usage is absent/empty

```sh
ndx hench show <run-id> --format=json .
```
Expected when usage fields are missing:
- `tokenUsage.input = 0`
- `tokenUsage.output = 0`
- `turnTokenUsage` still records the turn with zeros.

Remediation:
- Prefer emitting `usage.input_tokens` and `usage.output_tokens` from Codex-compatible wrappers.
- If upstream only provides `prompt_tokens`/`completion_tokens`, those are already mapped.
- If no usage fields are available, zero fallback is intentional; treat the warning as a data-quality signal.
