---
id: "90239cd3-5e2e-4223-bb91-43bae889384c"
type: "task"
title: "List --narrate in ndx analyze --help and say what each mode sends to a model"
slug: "list-narrate-in-ndx-analyze-help-and"
summary: "Finish the analyze help so a user can tell which options keep their code off any model."
description: "packages/sourcevision/src/cli/commands/analyze.ts has three modes: fast (static only, no model or network call), narrate, and generative (the default). `ndx analyze --help` (packages/core/help.js) lists --fast but not --narrate, and does not say that the default mode calls a model. Add --narrate with what it sends, state the default's model use in the description or the options, and make --deep's line say what it adds. Mirror the wording in `sv analyze --help` if it differs. Read analyze.ts to describe each mode accurately; do not change behaviour."
acceptanceCriteria:
  - "ndx analyze --help lists --narrate"
  - "The help states which of default, --narrate, --fast and --deep send code facts to a model"
  - "sv analyze --help matches"
  - "The help snapshot or text tests are updated and pass"
priority: "low"
tags:
  - "core"
  - "sourcevision"
  - "help"
source: "ndx-capture"
---
