---
id: "0704a8e5-e0a3-4831-9b92-b4ad1304312a"
type: "task"
title: "Work page browser-check fixes: inheritance flag, Ready to run placement, stacking offer and refresh after a switch"
slug: "work-page-browser-check-fixes"
description: "See the change's intent."
acceptanceCriteria:
  - "Units on no branch never read inherited, and a unit on the branch through its change still does (web route test)"
  - "On a work-set branch Ready to run sits directly under 'On this branch', and 'Not on a branch' is paged below it (viewer test)"
  - "Start a branch offers stacking only when the current branch has a work set, and the server refuses base 'current' otherwise (viewer and route tests)"
  - "After a switched Start a branch, the work-set section and Ready to run re-read without a reload (viewer test)"
priority: "high"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "ndx-capture"
---
