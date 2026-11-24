---
"@n-dx/core": patch
"@n-dx/web": patch
---

The sign-in link `ndx start` prints now stays valid for 30 minutes instead of about a minute, so it still works after you step away before opening it.

The link is still single-use: the first browser that opens it spends the nonce, and a second visit gets the sign-in notice. Scripts and MCP clients are unaffected; they keep sending the per-user token.
