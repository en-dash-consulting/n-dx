---
"@n-dx/core": patch
---

`ndx extensions add` resolves a relative path or tarball against the directory it runs in, not the n-dx home, and reads a `file://` URL as the path it names; re-adding an installed extension by path reports it as that extension; and every `ndx extensions` subcommand refuses a flag it does not take instead of dropping it.
