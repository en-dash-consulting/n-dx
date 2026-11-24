---
id: "3126ccc4-dea4-4cdb-ad07-16ad4c9cf60c"
type: "task"
title: "Solo / Team mode and a newcomer tour on Plan"
slug: "solo-team-mode-and-a-newcomer-tour-on"
summary: "A Solo / Team switch lets a one-person project hide assignees and the hand-off to an owner, and a short 'Take the tour' walkthrough explains the Plan page to someone opening it for the first time."
description: "Design: a 'Solo / Team' segmented control in the header. Solo hides assignee names and avatars, folds the triage step into 'Submitted', hides For me / Everyone, and words the Inbox as 'Your inbox'. 'Take the tour' opens a 4-step guided overlay (step 1: the three glance cards 'Start here every day'; then how work moves, the Inbox sorted by priority, and planning work onto the product map), with Skip and Next, highlighting each part in turn. Decide where the mode is stored (per browser, or project config) before building."
acceptanceCriteria:
  - "A Solo / Team control switches Plan between solo and team wording, hiding assignees and For me / Everyone in Solo"
  - "'Take the tour' opens a 4-step overlay that highlights each part of Plan in turn, with Skip and Next, and closes on Escape"
  - "The mode is remembered; the tour can be reopened at any time"
  - "Unit tests cover the mode switch and the tour's steps"
priority: "low"
source: "ndx-capture"
---
