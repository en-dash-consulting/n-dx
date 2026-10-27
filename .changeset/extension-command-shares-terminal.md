---
"@n-dx/core": patch
---

On macOS and Linux, `ndx <extension>` now runs the extension in the terminal's session instead of a detached one: it can prompt through `/dev/tty` (ssh, sudo, gpg), Ctrl+Z stops it with `ndx`, and closing the terminal (`SIGHUP`) reaches it rather than orphaning it.
