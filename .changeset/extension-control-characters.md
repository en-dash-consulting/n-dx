---
"@n-dx/core": patch
---

Extension manifests may no longer carry control characters (bidi embedding, override and isolate controls included) in any string or in the package name, and the package version must be semver; `ndx extensions list`, `info`, `doctor`, the approval prompt and the hint or refusal for an extension command print any control character from a package as a visible `\xNN` or `\uNNNN` escape, so a package cannot rewrite what the user approves.
