---
id: "00cd9a30-8a64-4626-8491-d6131ac019fa"
type: "task"
title: "remove --purge deletes the state folder a different package with the same extension name takes over"
slug: "remove-purge-deletes-the-state-folder"
description: "Verdict: should-fix. packages/core/extensions-command.js:378-403 looks for a successor only in ext.shadowed, which tracks the same packageName; ext.conflicts is ignored. Trigger: global @b/recon (name recon) owns ext/recon/; the user adds @a/recon (also recon) so both conflict; `ndx extensions remove @a/recon --purge` deletes ext/recon/ and @b/recon becomes the sole, enabled claimant with its state gone. Fix: skip the purge and say why when ext.conflicts is non-empty or any other discovered package has the same extension name."
acceptanceCriteria:
  - "remove --purge keeps ext/<name>/ when any other installed package claims the same extension name, and names it"
  - "A test covers the conflicting-package case"
priority: "medium"
tags:
  - "extensions"
  - "ndx-adversarial-review"
  - "severity:medium"
source: "ndx-adversarial-review"
---
