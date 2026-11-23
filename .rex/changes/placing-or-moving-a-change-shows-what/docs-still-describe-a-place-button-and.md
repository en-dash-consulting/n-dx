---
id: "ebd1ac09-7ae7-4252-89eb-43deafe347af"
type: "task"
title: "Docs still describe a Place button and omit the placement preview"
slug: "docs-still-describe-a-place-button-and"
summary: "The dashboard documentation still refers to a 'Place' button that is now labelled with the action, and doesn't mention the new preview. This updates it."
description: "Verdict: should-fix (severity low, docs only), from the adversarial review of feat/placement-visuals.\n\ndocs/packages/web.md:105 ('**Place** writes it') and :128 ('**Place** waits for an accepted check'); with a target and relation chosen the button now reads 'Touch X' or 'Amend X'. Nothing documents the preview or the Ask reparent card's 'Move to <parent>'."
acceptanceCriteria:
  - "docs/packages/web.md describes the confirm button's Touch/Amend label, the placement preview, and the Ask reparent card's Move to <parent> button"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
