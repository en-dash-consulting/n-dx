---
"@n-dx/web": patch
---

The dashboard's CLI probe (`<binary> --version` behind the model catalog) now runs with the environment the vendor's runs get under the project's own `llm.<vendor>.auth`, so a token such as `ANTHROPIC_AUTH_TOKEN` is no longer dropped when auth is unset. It falls back to the CLI login only when `api` has no usable key.
