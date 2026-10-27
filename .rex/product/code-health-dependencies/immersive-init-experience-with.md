---
id: "ccbcaf61-4e36-4fb0-b965-be25520ae453"
type: "capability"
title: "Immersive Init Experience with Dinosaur Theme & Branding"
slug: "immersive-init-experience-with"
statement: "The n-dx init command presents a branded En Dash DX flow with a dinosaur ASCII mascot, themed phase messages and a closing recap panel."
criteria: [{"id":"c1","text":"When init starts, the n-dx CLI shall display a dinosaur ASCII mascot of about 8 to 12 lines in the purple brand color."},{"id":"c2","text":"When init starts, the n-dx CLI shall display a branded banner that shows 'En Dash DX' as the full name and 'n-dx' as the tool identifier."},{"id":"c3","text":"While an init phase runs, the n-dx CLI shall show themed narrative spinner text for that phase, such as 'sniffing out your codebase...' for the sourcevision phase."},{"id":"c4","text":"When an init phase completes, the n-dx CLI shall show a themed success message for that phase."},{"id":"c5","text":"When init finishes, the n-dx CLI shall display a branded recap panel with a dinosaur celebration."},{"id":"c6","text":"If the NO_COLOR environment variable is set, the n-dx CLI shall run init without color output."},{"id":"c7","text":"If output is not a TTY, the n-dx CLI shall run init correctly without interactive spinner output."},{"id":"c8","text":"When init runs with --quiet, the n-dx CLI shall run init correctly without the branded output."}]
tags:
  - "ux"
  - "branding"
  - "cli"
source: "conversation"
priority: "high"
---

Replace the current minimal init banner and dry sub-package output with a cohesive, personality-driven flow featuring a cute dinosaur ASCII mascot and strong "En Dash DX" / "n-dx" branding. Extend cli-brand.js as the single home for all brand assets (mascot art, phase messages, colors).
