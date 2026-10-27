---
"@n-dx/core": patch
---

Give each extension its own config section, `extensions.<name>`, in `<ndx home>/config.json` and `.n-dx.json`, merged project over user. `ndx config extensions.<name>.<key> <value>` reads and writes it (`--user` writes the user config) and checks the result against the extension's `configSchema`; `--force` skips the check. For a command, the merged section is the file `NDX_EXTENSION_CONFIG` names (a sidecar gets the user section alone), and a run whose section breaks the schema, a missing required key included, is refused with exit 2. `paths` is now a reserved extension name, because the user config's `extensions.paths` lists dev paths.
