---
"@n-dx/core": patch
---

`ndx` now warns when a project on the `.ndx/` layout also has a root `.n-dx.json` or `.n-dx.local.json`, which it never reads.

Action needed: move those settings into `.ndx/config.json` (or `.ndx/config.local.json`), or set them with `ndx config`, then delete the root file.

The warning names each ignored file and its top-level sections, never values, and prints once per command. Before this, a setting such as `cli.timeouts.analyze: 0` in a stray root file silently did not apply. The file is not read as a fallback: each layout has one config source.
