---
id: "8480df4a-5852-49f0-a6bf-7a8cc5532364"
type: "task"
title: "Strip credentials from outbound targets and other literal URLs in analysis output"
slug: "strip-credentials-from-outbound"
summary: "Make sure web addresses that contain a username and password, or secret tokens, are written without the secret."
description: "**Operator note (2026-11-16, machine under heavy load):** run targeted tests only: the specific test files for the code you change, or one package's affected tests. No full suites, no `run-all-tests`, no fuzzing, no large generated repositories; small invented fixtures built in the test are fine. The six static root policy tests from the change's conventions are small and still required.\n\n**Problem.** `outbound.json` must never carry a secret. Measured on an invented PHP probe: database and cache targets drop credentials (`new mysqli('mysql://u:pw@host/x')` → `mysql://host/x`; `redis://:pw@host:6379` → `redis://host:6379`; a PDO DSN gives its host), but **`curl_init('https://u:pw@api.example.invalid/v1')` is written whole, password included**. HTTP targets are not stripped of userinfo.\n\n**Fix.** At the point where outbound dependencies are written (one place for every language, not per pack), any URL-shaped target loses its userinfo (`user:password@` and `:password@`), and any query parameter whose name is secret-shaped (password, passwd, pwd, pass, secret, token, api_key/apikey, access_key, auth, key, signature, sig, credentials; case-insensitive, `_`/`-` variants) keeps its name with the value replaced by a fixed placeholder such as `REDACTED`. A key=value DSN target (`…;password=…`) gets the same treatment. Reuse whatever helper already strips database URLs if it generalises; otherwise move that logic to the shared writer.\n\nAlso check `config.json` (config reads and flag checks) and every other artifact that can carry a literal from source (`zones.json` evidence, `CONTEXT.md`, `llms.txt`, findings) for the same shapes, and apply the same redaction where a literal URL or DSN can appear.\n\n**Tests:** invented PHP (`curl_init`, `file_get_contents('https://…')`, Guzzle `new Client(['base_uri' => 'https://u:pw@…'])`) and at least one non-PHP language's HTTP client with credentialed URLs and secret query parameters; assert targets keep scheme, host, port and path, drop userinfo and secret values, and that the probe's password strings appear in no output file. Existing outbound goldens change only where a target carried credentials."
acceptanceCriteria:
  - "No outbound target carries URL userinfo or a secret-shaped query value"
  - "Key=value DSN targets drop their password"
  - "The same redaction applies wherever a literal URL or DSN can reach an output file"
  - "Existing outbound goldens change only where a target carried credentials"
priority: "high"
run: {"tier":"standard","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "sourcevision"
  - "security"
  - "estate-readiness"
  - "php-pr12"
blockedBy:
  - "f9173794-5641-4098-b703-826467da5886"
---
