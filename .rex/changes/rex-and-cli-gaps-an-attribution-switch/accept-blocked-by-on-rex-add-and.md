---
id: "1ce411dd-e1a5-4039-936d-bea861c3fc76"
type: "task"
title: "Accept --blocked-by on rex add and update, document it, and document manual mode in ndx add --help"
slug: "accept-blocked-by-on-rex-add-and"
summary: "Make task ordering discoverable and settable with the usual flag spelling."
description: "rex add (packages/rex/src/cli/commands/add.ts) and rex update (update.ts) read `flags.blockedBy`; validate-input.ts lists `--blockedBy` for update. Accept `--blocked-by` as an alias in the flag parser for both commands (repeatable and comma-separated; an empty value clears on update), keep `--blockedBy` working, and list the flag in both help entries in packages/rex/src/cli/help.ts with an example. In packages/core/help.js, add the manual-mode flags (`--title`, `--parent`, `--criterion`, `--blocked-by`) to `ndx add --help` with a line saying they skip the smart-add model call."
acceptanceCriteria:
  - "rex add --blocked-by=<id> and --blocked-by=<a>,<b> set blockedBy; repeated --blocked-by flags accumulate"
  - "rex update --blocked-by= clears blockedBy"
  - "--blockedBy still works"
  - "rex add --help and rex update --help list --blocked-by"
  - "ndx add --help documents manual mode"
priority: "medium"
tags:
  - "rex"
  - "cli"
  - "help"
source: "ndx-capture"
---
