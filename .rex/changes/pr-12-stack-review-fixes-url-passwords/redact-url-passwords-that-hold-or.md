---
id: "840e6dd6-d79d-45a3-ac5d-b9d45e47bec0"
type: "task"
title: "Redact URL passwords that hold /, ? or #"
slug: "redact-url-passwords-that-hold-or"
summary: "Makes sure a database or cache address keeps no password in analysis output, even when the password contains a slash or a hash sign."
description: "In `packages/sourcevision/src/util/redact-literals.ts`, `redactToken` strips userinfo only inside `URL_AUTHORITY`, which ends at the first `/`, `?` or `#`. When the password holds one of them the `@` is never inside the match and the URL is kept whole.\n\nFix: within a token, after `scheme://`, treat the text up to the **last** `@` as userinfo when that text has the userinfo shape (a user with no `/`, `?`, `#` or `@`, then `:` and a password that may hold anything but whitespace and quotes) and the text after that `@` starts with a host (name, IPv4 or `[IPv6]`) followed by `:port`, `/`, `?`, `#` or the token's end. Keep today's first-`/` rule for everything else, so nothing that worked changes.\n\nMust stay unchanged (add as regressions, invented values):\n- `https://example.com/a@b`, `https://registry.example.org/@scope/pkg`, `https://host:8080/x@y`, `git@example.com:org/repo.git`, `mailto:a@b.example`.\n\nMust be redacted (expected output in brackets):\n- `mysql://app:pa/ss@db/app` [`mysql://db/app`]\n- `tcp://:se/cret@redis:6379` [`tcp://redis:6379`]\n- `postgres://u:p#ss@h/db` [`postgres://h/db`]\n- `pgsql://app:p@ss@pg/app` [`pgsql://pg/app`, as today]\n- `redis://:a/b?c#d@cache:6379/0` [`redis://cache:6379/0`]\n\nSame module, minor: a base64 value ending in `Key==` (e.g. `abcKey==`) becomes `abcKey=REDACTED` because the DSN rule reads `abcKey` as a parameter name and `=` as its value. Do not treat `=` padding as a value: a DSN or query entry whose value is only `=` characters is kept. `key=value` stays redacted (a bare `key` may be a real key).\n\nCheck where else in the stack userinfo is stripped by the same first-`/` rule (`packages/lang-php/src/php-outbound.ts` `CREDENTIALS`, if it still exists at this head) and route it through `redactLiterals` or apply the same rule, so the two cannot disagree.\n\nTests in sourcevision's redact-literals unit test (and lang-php's outbound test if touched). Patch changeset for `@n-dx/sourcevision` (and `@n-dx/lang-php` if touched)."
acceptanceCriteria:
  - "The five must-redact inputs give the expected outputs"
  - "The five must-stay inputs are unchanged"
  - "A value made only of = padding is not redacted"
  - "No other userinfo-stripping rule in the stack keeps a password holding /, ? or #"
priority: "high"
run: {"tier":"standard","review":true,"skipTestGate":true}
tags:
  - "sourcevision"
  - "security"
  - "php-pr12"
---
