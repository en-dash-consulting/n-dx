---
id: "1599644b-cbcc-4047-add7-2f3bd11a10c8"
type: "change"
title: "Inbox placement takes one click: best-guess Accept, Place best guesses, and a clickable Plan tile"
slug: "inbox-placement-takes-one-click-best"
summary: "Placing changes from the Inbox was slow and error-prone: the Plan page's Inbox buttons did nothing, and the placement form often defaulted to an \"amend\" that was then refused. Now each change can be placed on its best guess in one click, a whole backlog can be reviewed and placed at once, and the form starts on the safe choice."
intent: "The Plan page's Inbox tile was a preview with pointer-events off, so its Place buttons could not be clicked, and its header opened a modal holding the same five rows. The placement form pre-selected rex's suggested relation, so a change whose title opened with an amending verb opened on Amends and Place was refused with nothing to modify. With ~20 open and ~150 applied changes unplaced, there was no way to place many at once."
acceptanceCriteria:
  - "The Plan Inbox tile's body takes clicks, and its header opens the Inbox page rather than a full-screen preview"
  - "A row's Place opens the Inbox page with that change selected"
  - "A row with a best guess offers Accept, which places it on that guess as touches"
  - "Place best guesses reviews every change with a guess, weak guesses unticked, and places the ticked ones as touches in one write through POST /api/rex/changes/place-best, reporting refused pairs"
  - "The placement form opens on Touches, and Place stays disabled with a note while Amends has no criteria edit or replacement statement"
touches:
  - "89ecd7f3-ca6a-4833-90a4-7bc7b1017e94"
priority: "high"
tags:
  - "web"
  - "inbox"
  - "placement"
---
