---
id: "8feca975-1a79-4eb2-8fb8-50fea69012f6"
type: "capability"
title: "LoE-Calibrated Proposal Generation in rex add"
slug: "loe-calibrated-proposal-generation-in"
statement: "rex add generates consolidated work-package proposals that carry structured level-of-effort estimates, and splits any proposal whose estimate exceeds a configurable threshold into smaller child items for review."
criteria: [{"id":"c1","text":"When generating proposals, rex add shall produce fewer, larger work packages by default."},{"id":"c2","text":"rex add shall attach a structured level-of-effort estimate to each proposed item, made up of engineer-weeks, a rationale and a confidence."},{"id":"c3","text":"The proposal schema shall accept the level-of-effort estimate fields (engineer-weeks, rationale, confidence) on each proposal item."},{"id":"c4","text":"rex add shall apply post-processing guardrails to the generated proposals."},{"id":"c5","text":"The rex add CLI review shall display each proposed item's level-of-effort estimate."},{"id":"c6","text":"If a proposal item's level-of-effort estimate exceeds the level-of-effort threshold, rex add shall split that item into smaller child items."},{"id":"c7","text":"While no threshold is configured, rex add shall use a level-of-effort threshold of 2 engineer-weeks."},{"id":"c8","text":"When the user configures a level-of-effort threshold, rex add shall use that value in place of the default."},{"id":"c9","text":"When an item has been split, the rex add review shall show its child items inline."},{"id":"c10","text":"When an item has been split, the rex add review shall let the user accept the child items, keep the original item, or skip the item entirely."}]
source: "smart-add"
---
