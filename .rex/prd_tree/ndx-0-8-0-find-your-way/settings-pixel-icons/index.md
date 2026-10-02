---
id: "e8591691-eb7b-4158-be29-adee856325af"
level: "feature"
title: "Settings pixel icons"
status: "pending"
priority: "medium"
tags:
  - "0.8.0"
  - "settings-pixel-icons"
  - "robot-wrangler-redesign"
source: "claude-code: Robot Wrangler redesign session 2026-10-02"
acceptanceCriteria:
  - "The settings sidebar shows a pixel glyph for Robot Wrangler, Project, Workflow and Commands, and no 🧠 or 📤 remains in the settings overlay."
  - "The settings overlay header and the bottom bar's settings button show the pixel gear."
  - "The Robot Wrangler, Project and Workflow page headers show that page's pixel tile in place of the n-dx logo."
  - "Icons render with crisp pixel edges at every size they are used, in both dark and light themes."
  - "No change to settings behaviour, routes or saved config."
description: "The settings pages use a mix of colour emoji and monochrome symbols for their icons (🧠 Robot Wrangler, ▣ Project, ▶ Workflow, 📤 Commands, ⚙ for Settings itself), and none of them look like the 8-bit mascots the CLI packages use (the SourceVision eye pyramid, the Rex dinosaur, the Hench wrench in packages/*/…-F.png). This feature gives the four settings pages and the Settings gear pixel-art icons in that same family: a 22×22 pixel grid, the mascots' palette (navy #001769, purple #6c41f0, teal #00E5B9, steel #c8c6d6, white #ffffff), and a teal ground line under each tile.\n\nEach icon comes in two sizes. A 22×22 \"tile\" (navy square, art standing on a teal ground line) is used where there is room, such as a page header. An 11×11 \"glyph\" (transparent background, simplified art) is used in the settings sidebar and on the gear, drawn at 2 CSS px per pixel, because a 22×22 picture shrunk to 18px is unreadable.\n\nThe art: Robot Wrangler is a robot in a cowboy hat, Project is a folder with a slider on it, Workflow is a conveyor belt carrying two crates, Commands is a CRT monitor showing a \">_\" prompt, and Settings is a steel gear. The exact pixel maps are in the first task.\n\nThis is the first, deliberately small pull request of the Robot Wrangler redesign. It changes icons only; the page layout redesign follows in a separate feature.\n\nGoal: The settings pages look like they belong to the same 8-bit family as SourceVision, Rex and Hench."
lastModified: "2026-10-02T04:29:15.020Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add the settings pixel-art icon set and a PixelIcon component that renders it as inline SVG](./add-the-settings-pixel-art-icon-set.md) | completed |
| [Show each settings page's pixel tile in the Robot Wrangler, Project and Workflow page headers](./show-each-settings-page-s-pixel-tile.md) | pending |
| [Show the pixel glyphs in the settings overlay sidebar and on the Settings gear](./show-the-pixel-glyphs-in-the-settings.md) | completed |
