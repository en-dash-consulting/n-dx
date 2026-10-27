---
"@n-dx/core": patch
---

Extension manifests may no longer carry control characters in any string or in the package name, and the package version must be semver; `ndx extensions list`, `info`, `doctor` and the approval prompt print any control character from a package as a visible `\xNN` escape, so a package cannot rewrite what the user approves.
