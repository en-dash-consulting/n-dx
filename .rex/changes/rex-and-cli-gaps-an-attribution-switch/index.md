---
id: "62ca04e7-cd6b-45fc-aacc-b206c0d217d2"
type: "change"
title: "rex and CLI gaps: an attribution switch, --blocked-by and the dependency graph in status, sv workspace's root argument, --narrate in help"
slug: "rex-and-cli-gaps-an-attribution-switch"
summary: "Five small fixes that came up while using n-dx on other projects: let a project keep personal names and emails out of its tracked plan files, make task ordering settable and visible from the command line, stop one command from writing to the wrong folder, and finish the analyze help text."
intent: "Reported by downstream users (checked against 0.10.5).\n\n- **Attribution.** Every rex write stamps `lastModifiedBy: \"Name <email>\"` from git config (packages/rex/src/core/identity.ts, resolveActor) into tracked state.yaml files. A repository shared with a third party, or a machine whose git config switches identity per directory (`includeIf`), puts a personal or unexpected email into dozens of tracked files, with no way to turn it off. Default behaviour stays as it is.\n- **Dependencies from the CLI.** `rex add` and `rex update` accept `--blockedBy=<id,…>` (an empty value clears it), but neither `--help` mentions it and the kebab spelling `--blocked-by`, which every other multi-word flag uses, is not accepted. `ndx add --help` documents only smart add; manual mode (`--title`, `--parent`, `--criterion`) appears only in `ndx rex add --help`.\n- **Dependencies in status.** `ndx status` shows `blockedBy` only for items whose status is `blocked` (blockedBySuffix in packages/rex/src/cli/commands/status-shared.ts), so a pending item waiting on another reads as ready, and siblings sort alphabetically, hiding a planned sequence.\n- **sv workspace root.** packages/sourcevision/src/cli/index.ts passes the first positional argument to cmdWorkspace as the root, so `sv workspace --add <repoA> --add <repoB> <ws>` takes `<repoA>` (the value of a space-separated flag) as the root and writes members into `<repoA>`'s config.\n- **--narrate.** `ndx analyze --help` (packages/core/help.js) lists `--fast` but not `--narrate`, and says nothing about what each mode sends to a model."
acceptanceCriteria:
  - "A project can turn off name and email stamps in tracked PRD files, and the default is unchanged"
  - "rex add and rex update accept --blocked-by as well as --blockedBy, and both help texts document it"
  - "ndx status marks a pending item whose blockers are not done"
  - "sv workspace never takes a flag's value as its root"
  - "ndx analyze --help lists --narrate and says what each mode sends to a model"
touches:
  - "92864e0c-5476-4771-b05a-e75b9859fd2e"
  - "a53b2572-87a8-4eb2-804a-2b9ae668b930"
priority: "medium"
tags:
  - "rex"
  - "cli"
  - "sourcevision"
source: "ndx-capture"
---
