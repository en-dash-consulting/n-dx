---
id: "d3657f85-88f5-4f70-8948-56603a44ffe3"
type: "change"
title: "The trust strip still takes three lines and a third of the page beside the shell chrome"
slug: "the-trust-strip-still-takes-three"
intent: "Follow-up from the browser check of a6a7c43d (2026-11-09, untrusted worktree, Home and Plan): at 1024x768 the strip is 3 lines collapsed (63 px), and with Details open `.app-body` keeps 55% of the viewport (61% at 1440x900), because the 33dvh cap ignores the top nav and bottom bar. a6a7c43d's own criteria want at most about two lines collapsed and `.app-body` at two thirds or more. Lands in the same PR as a6a7c43d."
acceptanceCriteria:
  - "At 1024x768 and 1440x900, on Home and Plan, the strip is at most two lines collapsed and `.app-body` keeps at least two thirds of the viewport with Details open (browser check)"
touches:
  - "1bb0333a-d834-4e68-81d6-d728c2f8fcef"
priority: "high"
discoveredFrom: {"item":"a6a7c43d-5d1e-47f0-bf4f-c6e334ea78d1"}
source: "ndx-capture"
---
