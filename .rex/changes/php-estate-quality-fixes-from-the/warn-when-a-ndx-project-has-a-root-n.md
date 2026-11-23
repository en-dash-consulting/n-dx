---
id: "547c3e27-0626-4152-a2e1-79164f32a722"
type: "task"
title: "Warn when a .ndx/ project has a root .n-dx.json that is never read"
slug: "warn-when-a-ndx-project-has-a-root-n"
description: "On the .ndx/ layout config loads from .ndx/config.json and .ndx/config.local.json, and a root .n-dx.json is silently ignored. In a real deep run that made cli.timeouts.analyze: 0 not apply, and long analyses were killed at the 30-minute default. The orchestrator now warns once per command, naming each ignored file and its top-level sections (never values) and where they belong. It does not read the file as a fallback: one config source per layout."
acceptanceCriteria:
  - "ndx on a .ndx/ project with a root .n-dx.json or .n-dx.local.json prints one warning naming the file, its sections and the .ndx/ file to move them to"
  - "The warning never prints values and stays silent on the legacy layout"
priority: "high"
---
