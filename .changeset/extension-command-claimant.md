---
"@n-dx/core": patch
---

`ndx <name>` and `/x/<name>/` now resolve to the extension whose manifest is readable before an invalid or incompatible one with the same name. Previously a broken package earlier in precedence order hid the command `ndx --help` listed, and running it reported Unknown command.
