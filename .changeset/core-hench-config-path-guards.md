---
"@n-dx/core": patch
"@n-dx/hench": patch
"@n-dx/web": patch
---

`ndx config <pkg>.<key> <value>` refuses a key with a `__proto__`, `constructor` or `prototype` segment. `ndx config llm.__proto__.polluted x` followed `configs.llm["__proto__"]` onto `Object.prototype` and assigned there, in the CLI's own process; the write was never persisted, but the command now exits non-zero naming the segment and leaves every config file untouched. hench's `setConfigValue` applies the same guard behind its `CONFIG_FIELDS` allowlist.

The `ndx work` command that `ndx work --resolve` prints is now correct on Windows for a path that ends in a backslash or contains a quote: backslashes before a `"` or the closing quote are doubled, as the argv rules every Node program decodes with require, so `C:\My Repo\` prints as `"C:\My Repo\\"` rather than `"C:\My Repo\"`.

Four regular expressions that were quadratic on hostile input scan linearly: the `icacls` ACE parser behind owner-only config files (the same result on every icacls line; it now rejects a line with a `(` inside a flag group or a `:(` inside an identity, which icacls never prints), the trailing-separator trim in the MCP shim's workspace key, and the project-id slug in `ndx start` and its twin in the hub's new-project page (the same result on every input). `ndx ci`'s data-layer check now escapes every regex metacharacter in a layout directory name rather than only the dot.
