---
"@n-dx/llm-client": patch
---

Widen credential redaction: Stripe, SendGrid, Vault, Shopify, Twilio, Discord and Azure client-secret shapes, Slack and Discord webhook URLs, signed-URL query parameters, `Authorization: Token` headers, short Bearer tokens, PGP private key blocks, `Cookie`/`Set-Cookie` headers, `--token`-style flags, bare AWS secret keys beside an access key id, and more assignment keys (`*_PASS`, `PWD`, `AUTH`, `DSN`, `SIG`, `ENCRYPTION_KEY`, `SIGNING_KEY`, …). A password-named key now redacts short and all-digit values. Rules skip spans an earlier rule already replaced, so a URL whose userinfo is a token no longer comes out with a marker inside a marker.
