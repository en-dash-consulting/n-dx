---
"@n-dx/llm-client": patch
---

Redaction now covers Bitbucket and Atlassian credentials. The prefixed shapes are recognised wherever they appear — `ATBB` (Bitbucket Cloud app password), `ATCTT` (scoped Bitbucket access token), `ATATT` (Atlassian API token) and `BBDC-` (Bitbucket Data Center HTTP access token) — and two rules cover the forms a credential without a prefix of its own travels in: `Authorization: Basic <base64>`, which is how Bitbucket Cloud sends an app password, and the `-u user:password` flag, which keeps the username as URL userinfo already does. A credential printed bare with no prefix, key, flag or header is still out of reach; `redact.ts` says why.

`redactSecretsDetailed().kinds` now names each kind once, as documented. `assignment` is two rules and appeared twice when both fired.
