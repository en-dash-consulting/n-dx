---
id: "54b28dd7-df82-47e3-948f-2d76bfaeab90"
type: "change"
title: "Add interactive task-approval prompt to ndx self-heal before execution begins"
slug: "add-interactive-task-approval-prompt"
intent: "Modify the `ndx self-heal` pipeline so that after the analyze → recommend phase, all generated recommendations are persisted into the PRD folder tree (`.rex/prd_tree/`) with the existing `self-heal-items` tag, regardless of whether execution will follow. Persistence must happen before any hench execution begins so that aborting the run still leaves the recommendations captured. Use the existing recommend-accept code path so structure-health, deduplication, and reshape consolidation rules continue to apply."
acceptanceCriteria:
  - "Running `ndx self-heal` in a TTY without --auto/--yes prints the queued task list and waits for y/N confirmation before any hench run starts"
  - "Declining the prompt exits with a non-zero status and performs no PRD writes or hench invocations"
  - "Accepting the prompt proceeds through the existing self-heal loop with no behavior change beyond the added gate"
  - "Non-TTY invocations without an auto-confirm flag or config setting fail fast with a clear error explaining how to opt into unattended runs"
  - "Running `ndx self-heal` writes all generated recommendations into `.rex/prd_tree/` tagged with `self-heal-items` before any task execution begins"
  - "If the user cancels (Ctrl+C) after recommendations are generated but before execution, the recommendations remain persisted in the PRD"
  - "Items created during self-heal continue to carry the `self-heal-items` tag so the existing scoped task selection still works"
  - "Existing recommend-accept dedup, structure-health, and reshape consolidation paths are reused (no parallel write path introduced)"
  - "Regression test covers: recommendations generated → PRD contains tagged items → execution phase still runs against those items"
amends: [{"target":"4899a462-917d-4f59-baa9-cb49d1db202a","delta":"modified","summary":"Add interactive task-approval prompt to ndx self-heal before execution begins","base":"a8c97a70dd13d8ae316118cc10027e6641400841c9acbf791b29517a3bb4ba22"}]
priority: "high"
tags:
  - "cli"
  - "self-heal"
  - "ux"
  - "rex"
source: "smart-add"
---
