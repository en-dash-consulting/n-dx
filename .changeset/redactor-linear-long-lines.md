---
"@n-dx/llm-client": patch
---

Credential redaction stays linear on long lines: the assignment-key prefix and the URL scheme are bounded, and an assignment key must have its `=` or `:` within reach, so a 100 KB hyphenated or dotted line is scrubbed in milliseconds instead of tens of seconds. The token list also matches OpenAI's `sk-svcacct-…` and `sk-admin-…` keys (any `sk-` key whose body carries `-` or `_`), Google OAuth client secrets (`GOCSPX-`), Slack app tokens (`xapp-`), Grafana service account tokens (`glsa_`) and PyPI upload tokens (`pypi-`).
