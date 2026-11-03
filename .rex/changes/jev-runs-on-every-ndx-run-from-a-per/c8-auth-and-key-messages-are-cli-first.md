---
id: "f912174e-96e5-41a3-acd9-5c73bae27c5b"
type: "task"
title: "C8: auth and key messages are CLI-first and store-first"
slug: "c8-auth-and-key-messages-are-cli-first"
description: "PR 3, after T10b. Re-grounded 2026-11-03 against PR 2's tip 4f9b9ab00 (workshop credential-injection/05-pr3-reground; Q1-Q3 decided). Messages still wrong there: llm-client auth.ts:201 (\"found in .n-dx.json (claude.api_key)\"), auth.ts:141 and :252 (API before CLI); llm-error-classifier.ts:442 (`n-dx config claude.apiKey <key>`: wrong key name, key on argv) and :492 (Google names only GEMINI_API_KEY); auth-guidance.ts:65-66 (`ndx config llm.google.api_key <KEY>`); hench cli/errors.ts:149 and :162 (argv keys, API first); hench quota/codex-quota.ts:184, quota/codex-token-retrieval.ts:270 and quota/index.ts:139 (\"llm.codex.api_key in .n-dx.json\"); rex cli/errors.ts:110 (Google part); core config.js:888 (Google preflight); core file-permissions.js:270-271 (\"Prefer the ANTHROPIC_API_KEY environment variable\"); web routes-rex-analysis.ts:1137 (\"an optional faster path\"); and `ndx config credentials.<name> --helper \"bash -c ...\"`, whose refusal prints the internal credentials CLI usage text. Line numbers are as of 4f9b9ab00. Q1: respell only the messages this task rewrites; the other ~40 `n-dx` strings (Run 'n-dx init' and the like) are out of scope, since n-dx is a working bin alias. Never print a value."
acceptanceCriteria:
  - "Every message listed in the description puts the vendor's CLI login first where it has one, points at ndx config credentials.<vendor> for a key, never suggests a key as a command-line value, and says ndx rather than n-dx"
  - "Every message that offers a key says that storing it does not switch modes and llm.<vendor>.auth api does"
  - "The --helper refusal of an interpreter with inline code or no script is one line, like the metacharacter refusal, with no usage text (e2e)"
  - "A root test fails on any string literal in llm-client, hench, rex, core or web source that suggests a vendor key (api_key or apiKey) as a command-line value, and passes on this tree"
  - "Tests that asserted an old string are updated to the new one, not deleted"
priority: "low"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
blockedBy:
  - "94e25654-bb3c-4203-a1ab-49267e0ad734"
  - "10730d82-59f1-4ea2-9594-667318da70d2"
  - "b52513b3-58a0-4a2b-9e36-d116bdcf6a54"
---
