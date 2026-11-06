---
"@n-dx/core": patch
---

Under `llm.<vendor>.auth api` with no usable key, the Claude and Codex auth preflight (`ndx auth`, `ndx config llm.vendor`) reports the missing key as `NDX_<VENDOR>_PREFLIGHT_NO_KEY` instead of throwing, so `ndx init`'s `--soft-preflight` proceeds. The `--version` checks (`llm.codex.cli_path`, `--test-connection`'s cli_path test) resolve no key under `auth api`, so they pass without one and run no key helper.
