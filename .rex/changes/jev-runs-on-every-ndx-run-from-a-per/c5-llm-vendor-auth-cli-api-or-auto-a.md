---
id: "94e25654-bb3c-4203-a1ab-49267e0ad734"
type: "task"
title: "C5: llm.<vendor>.auth cli, api or auto; a store-only key never selects api"
slug: "c5-llm-vendor-auth-cli-api-or-auto-a"
description: "PR 2, first task (run order T7 -> T6 -> T8). New project setting llm.<vendor>.auth (cli | api | auto, default auto) chooses which credential a vendor gets; hench.provider (cli | api) still chooses hench's loop and stays a separate setting. Vendor keys start being read from the credential store here. Lookup order for a vendor key: legacy llm.<vendor>.api_key config, then the env var, then the store (today's resolveApiKey order with the store last, so nothing changes until a key is stored); TypeSafe stays env-first as in PR 1. Today detectAuthMode (create-client.ts) selects api from any resolved key, which rex analyze and sourcevision reach through createLLMClient; diagnoseAuth/detectAvailableAuth have no production caller. resolveVendorCliEnv (child-env.ts) copies a configured key into the CLI child and passes an exported key through. Under auth api with the CLI provider the stored vendor key may go into that vendor's own CLI child env only (the Claude CLI takes an API key only from env); typesafe and helper values never reach any child env. Never print or log a credential value; tests use placeholders in a temp ndx home."
acceptanceCriteria:
  - "ndx config llm.<vendor>.auth accepts cli, api and auto for claude, codex and google and refuses other values; default auto; cli is refused for google (no CLI), naming api"
  - "credentials.claude, credentials.codex and credentials.google are accepted by ndx config and dist/cli/credentials.js; CREDENTIAL_ENV_VARS maps them to ANTHROPIC_API_KEY, OPENAI_API_KEY and GEMINI_API_KEY, with google's apiKeyEnv override passed in"
  - "A new resolveVendorKey(vendor, config, {env, ndxHome}) returns {value, source: config|env|file} in the order config, env, store; resolveApiKey, detectAuthMode, api-provider.ts, openai-api-provider.ts, google-api-provider.ts and hench's api loop use it; exported from public.ts"
  - "auto selects api only from a config or env key; with only a stored key it selects the CLI (unit test per CLI vendor); with no store entry every mode choice and child env is byte-identical to main (test)"
  - "cli: resolveVendorCliEnv removes the vendor key env var (case-insensitively on win32) and injects no configured or stored key; Bedrock/Vertex mode credentials are untouched; createLLMClient uses the CLI provider even when a key resolves (tests)"
  - "api: a key from any source is used and the vendor CLI child gets only that vendor's key name; with no key it is a loud error naming ndx config credentials.<vendor> and llm.<vendor>.auth (tests)"
  - "hench refuses provider=api with auth cli before the run starts, naming both keys, and provider=api with auth auto and only a stored key gets the same loud error as auth api with no key (run-settings.ts unit tests); ndx work --resolve prints llm.<vendor>.auth with its source"
  - "ndx config credentials status prints each vendor's mode and key source (e.g. claude: cli (store key held, unused)), never the value (e2e); diagnoseAuth returns mode and keySource (unit test)"
  - "PR 1's no-stored-value-in-child-env test is narrowed to the api-mode vendor key in that vendor's CLI child, and still asserts typesafe and helper values never reach any child env"
priority: "medium"
run: {"models":{"claude":"claude-opus-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "credential-injection-design"
blockedBy:
  - "2f5ce643-1c49-4c70-ab2c-545f956873df"
---
