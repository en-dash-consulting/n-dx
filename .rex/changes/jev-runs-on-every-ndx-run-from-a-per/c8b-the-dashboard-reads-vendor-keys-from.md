---
id: "b52513b3-58a0-4a2b-9e36-d116bdcf6a54"
type: "task"
title: "C8b: the dashboard reads vendor keys from the credential store"
slug: "c8b-the-dashboard-reads-vendor-keys-from"
description: "PR 3, after T9 (decision Q2 in workshop credential-injection/05-pr3-reground). T8 moved vendor keys into the store, and two dashboard paths still assume a config file. (1) web/src/server/routes-config.ts:198 sets the footer's hasApiKey from claude.api_key in the config files only, so a project running on a stored key under llm.claude.auth api shows cli or none. llm-catalog.ts already uses resolveVendorAuth for the vendor cards; the footer should agree with them. (2) web/src/server/routes-commands.ts:1008 (init wizard) runs `ndx config llm.google.api_key <key>`, so the key is in the process list while the spawn runs and the history warning lands in the init log; `ndx config credentials.google --stdin` takes it on stdin. Line numbers are as of 4f9b9ab00. Never print or log a value; tests use placeholders and a temp ndx home."
acceptanceCriteria:
  - "The footer's auth method comes from resolveVendorAuth: api-key when the mode is api and a key resolves from any source, otherwise as today (test with a stored key under auth api, and under auto)"
  - "The init wizard stores a Google key with ndx config credentials.google --stdin, the key on stdin, and no spawned argv holds it (test on the spawn's argv); a failed store stays non-fatal"
  - "With nothing stored, the footer and the init wizard behave as before (test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
blockedBy:
  - "94e25654-bb3c-4203-a1ab-49267e0ad734"
  - "10730d82-59f1-4ea2-9594-667318da70d2"
  - "e5def056-c6ed-4484-978e-6f4e174bd8bf"
---
