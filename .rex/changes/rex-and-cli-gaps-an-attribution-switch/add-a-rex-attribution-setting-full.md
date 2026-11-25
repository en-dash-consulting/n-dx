---
id: "a24f2113-4338-42dc-8c38-b87f698a44a5"
type: "task"
title: "Add a rex attribution setting: full, name or none"
slug: "add-a-rex-attribution-setting-full"
summary: "Let a project choose whether its tracked plan files record who changed them by name and email, name only, or not at all."
description: "Add a rex setting `attribution: \"full\" | \"name\" | \"none\"` (default \"full\", today's behaviour), resolved the way other rex settings are (rex config, with the `rex` section of .n-dx.json / .n-dx.local.json if that is how rex settings layer). In packages/rex/src/core/identity.ts (resolveActor and its callers): \"full\" writes \"Name <email>\", \"name\" writes the name only (falling back to nothing when only an email is set), \"none\" writes no lastModifiedBy at all (lastModified timestamps stay). Applies to every writer: CLI, MCP and the v2 state.yaml path. Document the key in `ndx config --help` and the rex config docs. Do not rewrite existing stamps."
acceptanceCriteria:
  - "With attribution none, add_item and a status change write no lastModifiedBy to any tracked file"
  - "With attribution name, the stamp holds the git user name and no email"
  - "With no setting, stamps are unchanged from today"
  - "ndx config can set and show the key, and its help documents it"
  - "Unit tests cover the three modes for the v2 store"
priority: "medium"
tags:
  - "rex"
  - "privacy"
  - "config"
source: "ndx-capture"
---
