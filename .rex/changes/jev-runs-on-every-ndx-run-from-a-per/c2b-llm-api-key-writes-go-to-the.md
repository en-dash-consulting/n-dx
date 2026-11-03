---
id: "10730d82-59f1-4ea2-9594-667318da70d2"
type: "task"
title: "C2b: llm.*.api_key writes go to the credential store, with a one-time import from .n-dx.local.json"
slug: "c2b-llm-api-key-writes-go-to-the"
description: "PR 2, third task (after T7 and T6). ndx config llm.<vendor>.api_key (and legacy <vendor>.api_key) writes move from .n-dx.local.json to the credential store through the spawned llm-client CLI with the value on stdin. Under T7's auth auto a store-only key never selects api, but today writing llm.<vendor>.api_key switches rex and sourcevision to API mode; to keep that effect visible and explicit, the alias also sets llm.<vendor>.auth api in that checkout's .n-dx.local.json when auth is unset, and says so. The one-time import from .n-dx.local.json follows the same rule. Never print a value."
acceptanceCriteria:
  - "ndx config llm.<vendor>.api_key <value> (and legacy <vendor>.api_key) writes credentials.<vendor> through dist/cli/credentials.js with the value on stdin and no longer writes .n-dx.local.json; PR 1's argv warning applies (e2e)"
  - "When llm.<vendor>.auth is unset in that checkout the alias sets it to api in .n-dx.local.json and prints one line saying so; an explicit auth is never overwritten (e2e both ways)"
  - "When .n-dx.local.json holds an api_key, ndx config credentials offers on a TTY to move it and --import does it without a prompt; the store is written first and the key removed from the file only after the write succeeds (test with a failing write); the auth rule above applies per imported vendor; without a TTY or --import it only reports the key is there"
  - "ndx config llm.<vendor>.api_key with no value shows the stored entry's source and fingerprint, never the value"
  - "PR 1's e2e test that llm.claude.api_key behaves as on main is replaced by the alias tests, and the changeset states the behaviour change with a soft-freeze line"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
blockedBy:
  - "742863c5-989f-4138-8909-9b59bb589fc4"
  - "94e25654-bb3c-4203-a1ab-49267e0ad734"
  - "534debf3-0b82-43af-adf5-be497be7b85f"
  - "9dd5658d-a708-473b-acb0-63c8df1cc127"
---
