---
id: "4b5bea35-7ea0-4135-a478-c732154f06de"
type: "task"
title: "`ndx extensions` management commands"
slug: "ndx-extensions-management-commands"
acceptanceCriteria:
  - "`list`, `add <pkg>`, `remove <name> [--purge]`, `enable`, `disable`, `info`, `doctor`"
  - "`add` installs into `<ndx home>/extensions` without touching any project's `package.json`"
  - "`doctor` exits non-zero when any problem is found and prints one line per problem with its fix"
  - "`list --json` gives name, version, source, state (enabled, disabled, unapproved, incompatible) and reason"
priority: "high"
tags:
  - "extensions"
source: "ndx-capture"
blockedBy:
  - "e9435b47-1ab2-4739-9338-ab00f1c518d6"
---
