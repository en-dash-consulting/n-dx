---
"@n-dx/core": patch
---

Extension commands now run with the environment contract set: `NDX_EXTENSION_API`, `NDX_VERSION`, `NDX_BIN` (this install's `cli.js`, run with Node), `NDX_HOME`, `NDX_EXTENSION_NAME`, `NDX_EXTENSION_STATE_DIR` (`<ndx home>/ext/<name>/`, created on first run) and `NDX_EXTENSION_CONFIG`. `NDX_HUB_URL` and `NDX_TOKEN_FILE` are added when a hub is running. The token itself is never put in the environment.
