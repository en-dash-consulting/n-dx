---
id: "56517553-4651-4eec-aa2d-0788d1193da2"
level: "task"
title: "Vendor CLI environments keep each vendor mode's credentials from one mode table"
status: "pending"
priority: "high"
tags:
  - "security"
  - "issue-cleanup"
source: "ndx-capture"
acceptanceCriteria:
  - "Closes #635"
  - "child-env.ts has one table from vendor mode to activation signal, credential names and plumbing names; the Claude Bedrock and Vertex modes move into it unchanged in behaviour"
  - "Covered modes include at least Codex on Azure OpenAI (AZURE_* names and the env_key from the user's Codex config), Gemini with GOOGLE_API_KEY, and Gemini on Vertex (GOOGLE_GENAI_USE_VERTEXAI, GOOGLE_APPLICATION_CREDENTIALS and the documented project and location names), each citing the vendor CLI's documentation in a code comment"
  - "A test per mode: with the mode active, its names reach the spawned child; with the mode inactive, the same names are stripped; tests fail on the code before the fix"
  - "The Codex env_key is never taken from a repository-local .codex/config.toml or the repository's n-dx config; a test proves a repository-named env_key does not pull a credential into the child"
  - "The missing-credentials report covers every mode in the table, by name only"
description: "#635 (vendor CLI credential filter):\n\n> #623 filters credential-shaped variables out of vendor CLI environments and re-adds the active vendor's direct-API credentials (`resolveVendorCliEnv` in `packages/llm-client/src/child-env.ts`). Hal's review of #623 found that Claude on **Bedrock or Vertex** keeps its mode flags but loses its AWS and Google credentials. […]\n>\n> - **Codex on Azure OpenAI.** Every `AZURE_*` variable is stripped (`DEFAULT_ENV_DENY`), so an Azure-configured Codex (for example `AZURE_OPENAI_API_KEY`, or the `env_key` its `config.toml` names) would start without its key.\n> - **Gemini with `GOOGLE_API_KEY`.** The default `apiKeyEnv` is `GEMINI_API_KEY`, and `GOOGLE_API_KEY` matches `*_API_KEY`, so an operator who exports `GOOGLE_API_KEY` loses it.\n> - **Gemini on Vertex.** `GOOGLE_GENAI_USE_VERTEXAI` plus `GOOGLE_APPLICATION_CREDENTIALS`, the same shape as the Claude-on-Vertex case.\n>\n> One table from vendor mode to the exact credential names that mode needs, applied only when the mode is active (its flag or config is set). This replaces adding names case by case. Each entry gets a test that captures a spawned child's environment, like #623's existing tests.\n\nRe-checked 2026-10-16 on origin/main: `VENDOR_ENV` in `child-env.ts` has cloud modes for Claude only (Bedrock, Vertex). Codex has none, and Google has neither `GOOGLE_API_KEY` nor a Vertex mode.\n\nGeneralise `VENDOR_ENV` so every vendor's modes are rows in one table: mode → how it is detected as active → exact credential names → plumbing names. Cover at least Codex on Azure OpenAI (`AZURE_*` credentials and the `env_key` its config.toml names), Gemini with `GOOGLE_API_KEY`, and Gemini on Vertex (`GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_APPLICATION_CREDENTIALS`, plus the project and location names the CLI documents). Check every name against the vendor CLI's own documentation and cite the page in a code comment beside the row.\n\nSecurity constraint: a mode's names are re-added only while that mode is active, and the activation signal must not be something the repository controls. In particular, the Codex `env_key` is read only from the user's own Codex home config (`CODEX_HOME`, or `~/.codex/config.toml`), never from a repository-local `.codex/config.toml` or the repository's n-dx config. A repository that could name `env_key` could otherwise pull any credential into the child. llm-client stays dependency-free, so read only the keys needed rather than adding a TOML parser dependency.\n\nCredential names and values stay out of logs, PR text and test snapshots: the existing `onStripped` reports names only, and tests use sentinel values."
assignee: "Ryan Keith <ryan.k@endash.us>"
lastModified: "2026-10-16T21:50:10.278Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
