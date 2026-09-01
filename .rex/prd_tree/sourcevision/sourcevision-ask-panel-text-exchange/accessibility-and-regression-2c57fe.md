---
id: "2c57fe09-b75e-42e7-ad84-8f634d766e87"
level: "task"
title: "Accessibility and regression coverage for the Ask panel"
status: "pending"
priority: "medium"
tags:
  - "web"
  - "a11y"
  - "testing"
blockedBy:
  - "514d0d03-868a-4eaf-abeb-3e2abdd38bd5"
  - "74c3fee8-3281-4b30-8157-8794ea68aea5"
source: "ndx-capture"
acceptanceCriteria:
  - "The prompt textarea has a programmatic label, and the submit control is reachable and operable by keyboard alone"
  - "Answer arrival is announced via an aria-live region; the loading state is also announced"
  - "Copy and Capture controls are keyboard-operable and their success/error feedback is announced"
  - "Focus is never stolen from the textarea while the user is typing, and focus order remains sensible after an answer renders"
  - "Colour is not the only signal distinguishing error from success state"
  - "Tests cover the view's states and the route's contract, and run in the existing web unit suite without a live server or real LLM"
description: "Bring the panel to the accessibility bar the other SourceVision subviews already meet (see the Web Dashboard Accessibility epic, which covered the PR Markdown tab, file search, and route tree).\n\nAn async text exchange has one a11y requirement the other views do not: the answer arrives after an indeterminate delay, so a screen reader user must be told it arrived without losing their place. That means a live region, not just a rendered result."
lastModified: "2026-09-01T14:06:01.102Z"
lastModifiedBy: "Sterling H <sterling.h@endash.us>"
---
