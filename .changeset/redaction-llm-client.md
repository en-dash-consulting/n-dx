---
"@n-dx/llm-client": patch
---

Add `redactSecrets`, `redactSecretsDetailed` and `redactDeep`: credential redaction for text that is persisted or shown. Well-known token shapes (vendor API-key prefixes, JWTs, private-key blocks, bearer headers, URL passwords) and credential-shaped assignments (`GITHUB_TOKEN=…`, `api_key: …`) are replaced with `[redacted:…]` markers; run-record fields such as token counts are left alone.
