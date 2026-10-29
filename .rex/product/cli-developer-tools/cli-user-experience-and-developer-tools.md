---
id: "4ca9aac4-cd85-4af3-96d9-c4274e2d9f83"
type: "capability"
title: "CLI User Experience and Developer Tools"
slug: "cli-user-experience-and-developer-tools"
statement: "The n-dx command-line interface gives a unified configuration system across all packages, clear and actionable error messages, a discoverable help system with command-specific content and examples, and consistently formatted command output."
criteria: [{"id":"c1","text":"The n-dx CLI shall provide one configuration system that applies across all packages."},{"id":"c2","text":"If a command fails, the n-dx CLI shall report a clear, actionable error message instead of a raw technical failure."},{"id":"c3","text":"The n-dx CLI shall provide navigation, search and suggestions that help users discover the available commands."},{"id":"c4","text":"The n-dx CLI shall provide help for every n-dx command and subcommand, with command-specific content, examples and contextual guidance."},{"id":"c5","text":"The n-dx CLI shall format help content with standardized templates so it looks the same across all commands."},{"id":"extensions-manifest","text":"Separately installed packages declare commands, sidecars, links and config through an experimental versioned ndx.extension manifest; n-dx never imports extension code."},{"id":"extensions-approval","text":"Extensions run only after approval bound to the installed copy, version and manifest; revocation stops running sidecars and closes their connections."},{"id":"extensions-dispatch","text":"Built-ins take precedence and approved extension commands receive the documented environment, arguments, terminal signals and exit handling."},{"id":"extensions-sidecar","text":"The hub mounts enabled sidecars under /x/<name>/ with per-launch authentication, stripped hub credentials, approval revalidation and parent-lifetime shutdown."}]
source: "llm"
---

## History

- 2026-10-28 bcedb846-0028-43f6-95d3-7e2376bf06cc modified: Complete the experimental extension contract and stack review fixes
