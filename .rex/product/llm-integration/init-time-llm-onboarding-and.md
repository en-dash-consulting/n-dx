---
id: "8eaa2e3d-abe4-42aa-89c9-226e9877f2b6"
type: "capability"
title: "Init-time LLM Onboarding and Authentication"
slug: "init-time-llm-onboarding-and"
statement: "During init, n-dx guides first-time setup with a terminal banner and an LLM provider picker, checks that the terminal session is authenticated for the chosen provider, and lets rex, hench and sourcevision authenticate with the Claude API using an API key instead of the Claude Code CLI."
criteria: [{"id":"c1","text":"Rex, hench and sourcevision shall authenticate with the Claude API using an API key, without requiring the Claude Code CLI."},{"id":"c2","text":"When a user runs `n-dx init` or `ndx init`, the init command shall display a prominent terminal banner."},{"id":"c3","text":"When a user runs `n-dx init` or `ndx init`, the init command shall present an LLM provider picker that configures execution without manual config edits."},{"id":"c4","text":"When a provider has been selected during init, the init command shall check whether the current terminal session is authenticated for that provider."},{"id":"c5","text":"If the current terminal session is not authenticated for the selected provider, the init command shall direct the user to that provider's login command."}]
source: "smart-add"
---
