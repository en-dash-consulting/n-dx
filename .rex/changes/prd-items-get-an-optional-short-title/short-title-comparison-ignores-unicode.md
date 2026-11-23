---
id: "5f818bce-1e73-43a0-b1c2-ff44c43e9b32"
type: "task"
title: "Short-title comparison ignores Unicode normalization and zero-width characters"
slug: "short-title-comparison-ignores-unicode"
summary: "Two short names that look identical on screen can both be accepted if one uses a different character encoding or a hidden character. This compares names the way people see them."
description: "Verdict: should-fix (severity low, trivial), from the adversarial review of feat/short-titles.\n\nnameKey (packages/rex/src/core/short-title.ts:48) has no .normalize() and does not strip zero-width characters (\\s does not match U+200B). Trigger: 'Café' (NFD) is accepted against open title 'Café' (NFC); 'Wal​lets' against 'Wallets'.\n\nFix: nameKey applies .normalize('NFKC') and strips U+200B–U+200D and U+FEFF before case-folding and whitespace collapsing."
acceptanceCriteria:
  - "Names that differ only in Unicode normalization form are treated as equal"
  - "Names that differ only by zero-width characters are treated as equal"
  - "Unit tests cover both cases"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
