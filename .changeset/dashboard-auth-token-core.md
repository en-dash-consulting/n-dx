---
"@n-dx/core": patch
---

`ndx start` now creates the per-user dashboard token at `<ndx home>/auth.token`, passes it to the hub, single-project and preview servers it starts, sends it on its own hub probes, and prints URLs and MCP registration commands that carry it. Loopback is shared by every account on a machine; the token is what tells this user's browser and CLI apart from another account's process. `--no-auth`, or `web.auth: false` in the project's config file, turns it off; a home directory that cannot be written degrades to a warning rather than refusing to start. Authentication is a property of the hub, not of the project that happened to start it: `ndx start` refuses to register with a hub whose mode does not match, naming `ndx hub stop`, rather than silently joining an unauthenticated one. `--open` opens the same tokenised URL it prints.
