---
id: "73eb106d-acbe-4325-9009-7ef625aa193e"
type: "task"
title: "Your tooling lines open Robot Wrangler at the top, not at the field that edits them"
slug: "your-tooling-lines-open-robot-wrangler"
description: "Verdict: should-fix (low). Each line in the Tune \"Your tooling\" tile (packages/web/src/viewer/views/tooling-panel.ts, SettingsLink) goes to /robot-wrangler through navigateTo(view), which takes no field or section. Clicking the Heavy model for codex, or the review line, therefore opens Robot Wrangler at the top, and the user has to find section 3 (Models) or 5 (Review) themselves. Route overrides have no Settings field at all: Robot Wrangler shows which commands use each tier, but no control in the UI edits `llm.routes`. You can change them only through `ndx config` or PUT /api/llm/config. Reachable: every click on the tile. Options: (a) add a `section` option to NavigateTo, carried in the URL hash, and have Robot Wrangler scroll to an id on its Models and Review sections (it already scrolls to VENDOR_SECTION_ID). This is small, and the risk is the hash colliding with the legacy hash router (route-state parseLegacyHashRoute). (b) A query parameter instead of a hash avoids that collision. Recommended: (b). Separately, decide whether route overrides get a Settings field or the tile names `ndx config` as where they are changed."
acceptanceCriteria:
  - "Clicking a tier line in Your tooling opens Robot Wrangler scrolled to its Models section"
  - "Clicking the review line opens Robot Wrangler scrolled to its Review section"
  - "The route-overrides line points to a place that can edit llm.routes, or names the command that does"
  - "A unit test asserts the section each tile link targets"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
source: "ndx-adversarial-review"
---
