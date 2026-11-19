---
id: "2394e7aa-28ee-4f95-83b4-4e4bda26ce7f"
type: "task"
title: "Architecture findings in Recommended fixes are no longer most severe first"
slug: "architecture-findings-in-recommended"
summary: "Architecture findings in the recommended fixes list can show a minor item above more serious ones. This restores most-serious-first ordering."
description: "Verdict: should-fix (severity low, cheap), from the adversarial review of feat/analysis-two-tile-top-row.\n\nbuildInfraActions sorts relationships and patterns together by severity; the new stable sort by KIND_ORDER (action-items.ts:264, relationship before pattern) splits them again. On real data the order is r:info then p:warning ×5, contradicting the docstring 'architecture findings most severe first'.\n\nFix: give relationship and pattern the same KIND_ORDER rank."
acceptanceCriteria:
  - "Relationship and pattern findings in Recommended fixes are ordered together by severity"
  - "A test asserts a warning pattern sorts ahead of an info relationship"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
