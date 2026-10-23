---
id: "5fd0de0b-02c3-4895-88be-a0b13f404b8e"
type: "capability"
title: "External Integration Configuration UI"
slug: "external-integration-configuration-ui"
statement: "The configuration UI lets users set the Claude access mode and integration settings such as Notion's, and revise LLM-generated proposals with natural-language feedback."
criteria: [{"id":"c1","text":"The configuration UI shall let users choose between Claude Code CLI and an Anthropic API key, and that setting shall apply across sourcevision, rex and hench."},{"id":"c2","text":"When an LLM-generated proposal is presented, the product shall accept natural-language feedback that modifies the proposal, in addition to accepting or rejecting it."},{"id":"c3","text":"The configuration UI shall let users configure and manage Notion integration settings."},{"id":"c4","text":"The configuration UI shall handle Notion credentials securely."},{"id":"c5","text":"The configuration UI shall validate the Notion connection."},{"id":"c6","text":"The configuration framework shall support external integrations beyond Notion by generating their configuration UI dynamically."}]
source: "smart-add"
---
