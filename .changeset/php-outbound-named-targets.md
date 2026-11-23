---
"@n-dx/lang-php": patch
"@n-dx/sourcevision": patch
---

PHP outbound calls in `outbound.json` now name where they go when the address isn't a plain literal, instead of leaving `target` empty.

A constant or `$config['a']['b']` key that the repository sets to exactly one literal value now resolves to that value, credentials dropped. A constant or config key with no single value is named, with `targetSource: config`. Anything else, such as a property, a parameter or a call result, keeps the argument as written with `targetSource: unknown`. Analyze prints one line counting targets by source.
