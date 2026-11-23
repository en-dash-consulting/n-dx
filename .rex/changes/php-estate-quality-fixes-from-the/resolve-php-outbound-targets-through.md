---
id: "d38080d7-5ed8-49e0-a77e-11ffe05c92ba"
type: "task"
title: "Resolve PHP outbound targets through constants and config reads"
slug: "resolve-php-outbound-targets-through"
summary: "Fill in where a legacy PHP app's outside connections go, such as SOAP services, HTTP calls and databases, when the address comes from a constant or a config file. Most were blank in the first real scan."
description: "**Problem (real deep run).** 74 of 94 outbound dependencies had target `\"\"` and targetSource `unknown`. Most were SoapClient and curl calls whose URL comes from a `define()` constant or a config array, which PR 7's `config.json` already records the keys of.\n\n**Fix.**\n- When an outbound target is a constant (`SOAP_WSDL`, `API_BASE . '/x'`) or a config read (`$config['api']['url']`), resolve it statically:\n  - for a constant defined once in the repository with a literal value, through the include ladder's constant table (PR 4);\n  - otherwise through config files the target's file can reach, from PR 7's config sources.\n- With a literal value, set target and targetSource `literal`, keeping the existing credential stripping (PR 12).\n- Otherwise set targetSource `config` or `env`, and target to the key or constant name as written. Never leave it blank when a name is known.\n- Report per-repo counts of resolved, named and unknown targets.\n\n**Tests:** an invented fixture with a SoapClient on a defined constant, curl on a config array value, a concatenated constant, a constant defined twice (stays named, not resolved), and a credentialed URL constant (resolved with the credentials stripped)."
acceptanceCriteria:
  - "Outbound targets built from a once-defined literal constant or a reachable config value resolve to the literal value, with credentials stripped"
  - "Targets that can't be resolved carry the constant or config key as written, with targetSource config or env, not an empty target"
  - "Per-repository counts of resolved, named and unknown targets are reported"
priority: "medium"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":120}
tags:
  - "lang-php"
  - "outbound"
blockedBy:
  - "50ba9fa8-d954-49ed-9ec3-cb82a6e84a12"
---
