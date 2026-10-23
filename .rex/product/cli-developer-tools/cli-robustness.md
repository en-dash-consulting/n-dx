---
id: "f69ce6c6-57f4-4fc6-8f06-beb5e538d8fc"
type: "capability"
title: "CLI Robustness"
slug: "cli-robustness"
statement: "The CLI validates command input, loads and validates configuration with project-level overrides, reports errors clearly while degrading gracefully, reports results for CI, lets users approve proposals through smart add, and exposes rex to hench through a public API."
criteria: [{"id":"c1","text":"The ci command shall report its results in a form that CI systems can consume."},{"id":"c2","text":"The CLI shall validate command input before it executes a command."},{"id":"c3","text":"When a command produces JSON output, the CLI shall use the same JSON output format across commands."},{"id":"c4","text":"The CLI shall load and validate its configuration."},{"id":"c5","text":"When a project-level override is present, the CLI shall apply it over the default configuration."},{"id":"c6","text":"If a command fails, the CLI shall report an error message that explains the failure."},{"id":"c7","text":"If a dependency of a command is unavailable, the CLI shall degrade gracefully instead of failing outright."},{"id":"c8","text":"The rex package shall re-export the functions and types its consumers use from packages/rex/src/public.ts."},{"id":"c9","text":"The rex package shall declare an exports field in its package.json that maps the rex entry point to dist/public.js."},{"id":"c10","text":"Hench shall import rex functions through the rex public API, not through internal dist/ paths."},{"id":"c11","text":"The rex package shall keep its internal implementation details behind its public API."},{"id":"c12","text":"The smart add interface shall let the user approve and manage proposals."}]
source: "llm"
parentId: "9af1c83c-cf4d-4f8f-b343-6857cb6b66a6"
---
