---
id: "c5ba3c69-5738-421f-8648-76956e36b869"
type: "task"
title: "Apply semantic success and pause colors to hench run-loop status messages"
slug: "apply-semantic-success-and-pause"
description: "Color-code the two recurring run-loop progress messages using the established STATUS_COLORS / llm-client color helpers. The run-success line ('All tasks complete' or equivalent) should render in green to confirm a clean exit; the inter-task pause line ('Pausing ...ms before next task...') should render in yellow to signal a transient wait state. Both messages must honour TTY detection and NO_COLOR."
acceptanceCriteria:
  - "The run-success message is rendered with colorSuccess (green) when stdout is a TTY and NO_COLOR is unset"
  - "The inter-task pause message is rendered with colorWarn or colorPending (yellow) under the same conditions"
  - "Both messages render as unstyled plain text when NO_COLOR=1 or stdout is not a TTY"
  - "No new color primitives are introduced — existing helpers from @n-dx/llm-client (colorSuccess, colorWarn, colorPending) are reused"
  - "An integration or e2e assertion verifies the correct ANSI codes appear in TTY mode and are absent under NO_COLOR"
priority: "medium"
tags:
  - "hench"
  - "cli"
  - "color"
  - "ux"
source: "smart-add"
---
