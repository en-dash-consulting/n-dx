---
"@n-dx/llm-client": patch
"@n-dx/core": patch
---

Send the Gemini API key in the `x-goog-api-key` header, not the URL.

Every Gemini request built the key into the URL query string
(`…/models/<model>:generateContent?key=<API_KEY>`, and `…/models?key=…` for
auth validation), where proxies, corporate egress logs, and any future
URL-logging path record it. The `n-dx config llm.google.api_key` validation
preflight (`packages/core/config.js`) did the same.

All Gemini fetches — completions, streaming, tool calls, `validateAuth`, and the
config preflight — now pass the key as the `x-goog-api-key` request header and
build a key-free URL (streaming keeps `?alt=sse`). Same endpoints, same auth, no
behaviour change. A test asserts no request URL contains `key=` and the header
carries the key.

Found by the 2026-09-11 adversarial security review (finding G).
