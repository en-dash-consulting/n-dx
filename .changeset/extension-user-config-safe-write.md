---
"@n-dx/core": patch
---

`ndx config extensions.<name>.<key> --user` no longer replaces a malformed `<ndx home>/config.json`: it fails naming the file and leaves it as it was. The write now goes through a temporary file and a rename. Reserved names such as `paths` are refused as a config section even with `--force`, so `extensions.paths` cannot be overwritten.
