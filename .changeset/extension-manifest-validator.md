---
"@n-dx/core": patch
---

Add the `ndx.extension` v1 manifest contract: a JSON Schema (`extension-manifest.schema.json`) for extension publishers, and the validator n-dx runs on it. Each problem is reported as one line naming the package, the JSON path, the rule and the fix. A manifest for an `apiVersion` this n-dx does not speak is reported as incompatible, not invalid.

Manifest paths reject drive-relative escapes and diagnostics escape control characters.
