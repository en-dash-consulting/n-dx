---
"@n-dx/llm-client": patch
---

Add `redactSecrets`, `redactSecretsDetailed` and `redactDeep`: credential redaction for text that is persisted or shown. Well-known token shapes (vendor API-key prefixes, JWTs, private-key blocks, bearer headers, URL passwords) and credential-shaped assignments (`GITHUB_TOKEN=…`, `api_key: …`) are replaced with `[redacted:…]` markers; run-record fields such as token counts are left alone. An assignment's value is taken whole — a quoted value to its closing quote, an unquoted one to the end of the line — so a passphrase containing spaces no longer survives in the clear. `createLineRedactor` is the stateful, line-at-a-time form for callers that never hold the whole text, such as a streaming log writer: it catches a private-key block whose BEGIN and END markers fall on different lines.
