---
id: "ef198516-592b-473a-8a8f-e0c7a0b12bc1"
type: "change"
title: "Redesign ndx init ASCII dinosaur to match Rex-F.png proportions"
slug: "redesign-ndx-init-ascii-dinosaur-to"
intent: "The current ASCII art dinosaur in the ndx init banner has incorrect body proportions relative to the Rex-F.png reference image (packages/rex/Rex-F.png). Audit the reference image, identify the key proportion mismatches (head size, tail length, leg stance, overall silhouette), and redraw the ASCII art character to closely follow the reference. The fix should be applied to whichever module renders the init banner output."
acceptanceCriteria:
  - "The new ASCII art is visually compared against Rex-F.png and the proportions are judged as substantially more accurate (head-to-body ratio, tail curve, leg placement)"
  - "The ASCII art renders without line-wrapping at standard 80-column terminal width"
  - "The ASCII art renders correctly with and without ANSI color codes (i.e., no invisible characters disrupting column alignment)"
  - "Running `ndx init` in a clean temp directory displays the updated dinosaur"
  - "No existing snapshot or integration test is broken by the change; any affected test is updated to reflect the new art"
touches:
  - "453e030c-021c-4f41-a39f-eb7804e356b4"
priority: "low"
tags:
  - "cli"
  - "branding"
  - "init"
source: "smart-add"
---
