---
id: "8cdfc6e9-6a56-46ce-a44b-9e461dc45892"
type: "task"
title: "P8: match a PSR-0 prefix only on a namespace boundary"
slug: "p8-match-a-psr-0-prefix-only-on-a"
summary: "Stops an older-style package mapping from claiming unrelated libraries whose names merely start the same way."
description: "#1082 review P8 (medium), `packages/lang-php/src/php-resolver.ts` (`lower.startsWith(p)` in the PSR-0 lookup, and the matching PSR-0 path at the other call site).\n\nTrigger: `\"psr-0\": {\"Acme\": \"src/\"}`, the Monolog 1.x / Guzzle 3 style. `use AcmeCorp\\Sdk\\Client` comes out `internal-not-found` and is dropped from externals.\n\nFix: a PSR-0 prefix with no trailing `\\` or `_` matches only when the class name equals it or continues with `\\` or `_` (PSR-0 also maps `_` to a directory separator). Prefixes that end in `\\` or `_` behave as today.\n\nTests (invented composer.json): `Acme` maps `Acme\\Foo` and `Acme_Foo` but not `AcmeCorp\\Sdk\\Client`, which stays an external."
acceptanceCriteria:
  - "A PSR-0 prefix without a separator does not claim a longer namespace"
  - "Existing PSR-0 resolution is unchanged"
priority: "medium"
run: {"tier":"light","review":true,"skipTestGate":true}
tags:
  - "lang-php"
  - "resolution"
---
