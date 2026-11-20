---
id: "11df5f27-e8e0-42b3-adda-7331247ea363"
type: "capability"
title: "Config reads and feature-flag checks"
slug: "config-reads-and-feature-flag-checks"
statement: "Language packs can report where code reads configuration and where it checks feature flags, with the code each check gates and no values, and sourcevision writes them to config.json; PHP is the first producer."
criteria: [{"id":"config-json","text":"config.json holds config reads and flag checks only when a pack produced them"},{"id":"php-flags-config","text":"PHP flag checks, config sources and host-selected tenant configs are reported"}]
---

## History

- 2026-11-16 b74c12c2-673c-488b-9559-9f999d9440b4 added: Config reads and feature-flag checks (config.json)
