---
"@n-dx/web": patch
---

A connection with `auth: "oauth"` signs in through the MCP SDK's OAuth flow (discovery, dynamic client registration, PKCE) and refreshes its token silently. The client registration and tokens are stored together as `connection:<id>` in the credential store, bound to the server URL. A revoked or unrefreshable token reads "needs sign-in" rather than failing the session.
