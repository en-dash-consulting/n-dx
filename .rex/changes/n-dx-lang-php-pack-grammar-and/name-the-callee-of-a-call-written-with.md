---
id: "2104cdb9-fd29-4472-9c32-8e2b74f973e5"
type: "task"
title: "Name the callee of a call written with a space before its parenthesis"
slug: "name-the-callee-of-a-call-written-with"
summary: "Older PHP code often writes a space between a function name and its parentheses, as in mysql_query ($sql). Those calls are recorded without the name of what was called today, so every rule that reads calls would miss them."
description: "In-scope fix for review finding 9608fc01 (run 27d70059 of task 5cd796e9); read that change's intent for the scenario and the evidence. callSites in packages/lang-runtime/src/pack-calls.ts pairs a @call.name with an argument list only when the name ends exactly where the list starts, so `foo ($x)` and `$db->query ($sql)` get no callee and no receiver. Take option 1 from the finding: when no name ends at the list start, use the @call.name inside the same invocation that ends latest before the list start and is not inside another argument list. Keep the fix in the runtime, not a PHP-only reader. Add a patch changeset for @n-dx/lang-runtime.\n\n**Operator note, 2026-11-14:** the operator built every pack's grammar before this run, so the WASM files are present and the grammar tests do not skip. Run `npx vitest run` inside packages/lang-runtime, lang-php, lang-python, lang-java and lang-go (setting env vars on a command is refused, so do not prefix SV_REQUIRE_GRAMMARS). Python, Java and Go goldens must be unchanged, or any diff must be only calls written with a space and be explained in the commit message. Never commit anything under any package's build/."
acceptanceCriteria:
  - "groupCalls gives `foo ($x)` the callee foo and `$db->query ($sql)` the callee query and receiver $db (unit test in lang-runtime pack-calls.test.ts)"
  - "The PHP pack's facts for a file with `mysql_query ($sql)` name the callee (lang-php test and golden)"
  - "Python, Java and Go pack goldens are unchanged, or their diffs are limited to calls written with a space and are explained"
priority: "high"
run: {"tier":"standard","review":true,"reviewTier":"standard","skipTestGate":true,"maxTurns":100}
source: "ndx-adversarial-review"
---
