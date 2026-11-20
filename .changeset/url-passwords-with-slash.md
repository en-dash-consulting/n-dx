---
"@n-dx/sourcevision": patch
"@n-dx/lang-php": patch
"@n-dx/lang-kit": patch
---

`sv analyze` now removes a URL password that holds `/`, `?` or `#`. Before this, a URL such as `mysql://app:pa/ss@db/app` was written whole, password included. Generated passwords often hold `/`.

The PHP pack's outbound targets follow the same rule. Before this, a password holding `@` or `#` could leave part of itself in the target. A base64 value ending in `=` padding (`abcKey==`) is no longer turned into `abcKey=REDACTED`.
