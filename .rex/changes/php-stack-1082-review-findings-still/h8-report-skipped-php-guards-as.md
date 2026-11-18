---
id: "a739a401-b0e9-4203-9156-16e8431a584f"
type: "task"
title: "H8: report skipped PHP guards as skipped and pass changed paths to php with ./"
slug: "h8-report-skipped-php-guards-as"
summary: "Makes the coding agent's PHP checks say when nothing was actually checked, and stops a strangely named file from being read as a command option."
description: "#1082 review H8 (low), hench PHP guards (`packages/hench/src/tools/php-guards.ts`).\n\n1. \"PHP guards passed\" is reported (`ok: true, checks: 0`) when every check was skipped. Report \"skipped\" with the reasons instead, and keep `ok: true` so a run is not failed by it.\n2. A root file named `-zx.php` passes `SHELL_SAFE_PATH` and reaches `php` as an option. Prefix every relative path passed to `php`/`composer` with `./` (or pass `--` where the tool supports it).\n\nTests: all checks skipped gives a skipped result and message; a changed `-zx.php` reaches `php -l` as `./-zx.php`."
acceptanceCriteria:
  - "All-skipped guards report skipped, not passed"
  - "A path starting with - cannot reach php as an option"
priority: "low"
run: {"tier":"light","review":true,"skipTestGate":true}
tags:
  - "hench"
  - "hardening"
---
