---
id: "1c9a9160-e4fb-4e27-96b1-c0cdf0a9830c"
type: "change"
title: "Wire --auto/--yes flags and selfHeal.autoConfirm config to bypass the prompt"
slug: "wire-auto-yes-flags-and-selfheal"
intent: "Extend the self-heal CLI argument parser to recognize an auto-confirm flag (reusing the existing --auto/--yes convention used elsewhere in ndx where applicable) and add a `selfHeal.autoConfirm` boolean to the `.n-dx.json` schema and `ndx config` surface. When either signal is present, skip the confirmation prompt entirely so scheduled and CI-driven self-heal runs remain non-interactive. Document the precedence (CLI flag overrides config) and update help text."
acceptanceCriteria:
  - "`ndx self-heal --auto` (and --yes if currently supported by self-heal) skips the confirmation prompt and runs end-to-end without stdin interaction"
  - "Setting `selfHeal.autoConfirm=true` via `ndx config` or `.n-dx.json` skips the prompt for all subsequent self-heal invocations"
  - "CLI flag takes precedence over config when both are present (flag=true overrides config=false and vice versa)"
  - "`ndx self-heal --help` and the config schema documentation describe the new flag/setting and their interaction"
  - "Regression tests cover flag-only, config-only, both-set, and neither-set cases against the prompt gate"
touches:
  - "4899a462-917d-4f59-baa9-cb49d1db202a"
priority: "high"
tags:
  - "cli"
  - "self-heal"
  - "config"
source: "smart-add"
---
