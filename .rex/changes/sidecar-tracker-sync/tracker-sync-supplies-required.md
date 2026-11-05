---
id: "3b86452e-1829-499a-af72-1620953e00e7"
type: "task"
title: "Tracker sync supplies required workflow facts or falls back to a card"
slug: "tracker-sync-supplies-required"
description: "Story 46 (CAOS 3f7a80b7-1924-81b1-8321-d6a2f010c472). Facts the profile's mapping requires per event come from their named source: reviewer (profile default, else CODEOWNERS for the PR's files), review link (the PR URL), delivery note (\"shipped in ndx X.Y.Z\" from the release), blocked reason and who can unblock (the run diagnosis). A missing fact turns the planned call into a card entry naming the missing fact, never a guess. Tracker limits declared in the profile (CAOS: cannot create epics, cannot assign work windows) surface as cards naming what the operator must create (e.g. \"Create feature 'X' under epic Y in CAOS, then map it\"). Follow the shared rules in the parent change's description."
acceptanceCriteria:
  - "With a profile default reviewer or a CODEOWNERS match the PR-opened move carries the reviewer and review link; with neither it becomes a card naming the reviewer as missing (tests)"
  - "The release move carries the delivery note from the release version; the blocked move carries the diagnosis summary (tests)"
  - "A missing feature mapping raises a card naming the feature to create and makes no call (test)"
priority: "medium"
run: {"models":{"claude":"claude-sonnet-5-5"},"review":true,"reviewModels":{"claude":"claude-opus-5-5"}}
source: "caos"
---
