---
id: "453e030c-021c-4f41-a39f-eb7804e356b4"
type: "capability"
title: "Dinosaur ASCII Art Proportions Fix"
slug: "dinosaur-ascii-art-proportions-fix"
statement: "The `ndx init` banner shows an ASCII-art dinosaur drawn to the proportions and silhouette of the Rex-F.png mascot."
criteria: [{"id":"c1","text":"When `ndx init` runs in a clean directory, the init command shall display the dinosaur ASCII art in its banner."},{"id":"c2","text":"The init banner shall draw the dinosaur with the head-to-body ratio, tail curve and leg placement of the Rex-F.png reference image."},{"id":"c3","text":"The init banner shall render the dinosaur ASCII art without line-wrapping in an 80-column terminal."},{"id":"c4","text":"The init banner shall keep the dinosaur ASCII art's column alignment the same whether or not ANSI color codes are emitted."}]
source: "smart-add"
---

The dinosaur rendered in the `ndx init` banner does not accurately represent the Rex-F.png mascot image used in marketing and branding. This feature corrects the ASCII art to match the proportions and silhouette of the reference image.
