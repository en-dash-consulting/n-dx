---
"@n-dx/web": patch
---

A connection's unavailable reason no longer carries its stored token: a server error body that echoes the token reads as the token's fingerprint, secret-shaped text is redacted, the reason is capped at 300 characters, and it still names the HTTP status.
