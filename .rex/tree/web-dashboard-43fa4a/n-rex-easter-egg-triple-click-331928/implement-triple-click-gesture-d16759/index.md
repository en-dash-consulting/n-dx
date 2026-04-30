---
id: "d167596a-802c-4832-b797-b9d6a418774b"
level: "task"
title: "Implement triple-click gesture detector with probabilistic trigger gate on the rex icon"
status: "completed"
priority: "low"
tags:
  - "web"
  - "ui"
  - "easter-egg"
source: "smart-add"
startedAt: "2026-04-19T04:48:04.953Z"
completedAt: "2026-04-19T04:55:01.652Z"
acceptanceCriteria:
  - "Three clicks on the rex icon within 1.5 seconds (each gap ≤ 1.5 s) correctly arms the trigger"
  - "A fourth click after the 1.5 s window resets the counter to 1"
  - "The probability gate fires with p ≈ 0.271828 — unit test mocks Math.random to verify both the pass (< 0.271828) and reject (≥ 0.271828) branches"
  - "No easter egg fires on a double-click or on three clicks spread across more than 1.5 s total"
  - "Gesture detection logic is self-contained and does not import rendering code"
description: "Wire a click-sequence tracker to the rex icon component that records timestamp of each click, resets if the gap between any two consecutive clicks exceeds 1.5 seconds, and on the third qualifying click rolls Math.random() < 0.271828 to decide whether to fire the easter egg event. Emit a custom event or call a provided callback when the gate passes so the display layer remains decoupled."
---

# Implement triple-click gesture detector with probabilistic trigger gate on the rex icon

⚪ [completed]

## Summary

Wire a click-sequence tracker to the rex icon component that records timestamp of each click, resets if the gap between any two consecutive clicks exceeds 1.5 seconds, and on the third qualifying click rolls Math.random() < 0.271828 to decide whether to fire the easter egg event. Emit a custom event or call a provided callback when the gate passes so the display layer remains decoupled.

## Info

- **Status:** completed
- **Priority:** low
- **Tags:** web, ui, easter-egg
- **Level:** task
- **Started:** 2026-04-19T04:48:04.953Z
- **Completed:** 2026-04-19T04:55:01.652Z
- **Duration:** 6m
