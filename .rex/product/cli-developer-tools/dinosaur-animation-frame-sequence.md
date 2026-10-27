---
id: "6db5328c-2df6-437a-80a1-771fa55401a5"
type: "capability"
title: "Dinosaur Animation Frame Sequence Correction"
slug: "dinosaur-animation-frame-sequence"
statement: "The ndx init dinosaur animation opens on a frame drawn from Rex-F.png and builds each later frame from the reference image closest to Rex-F.png."
criteria: [{"id":"c1","text":"The ndx init dinosaur animation shall render Rex-F.png's proportions, silhouette, head, body, tail and limbs as its first frame."},{"id":"c2","text":"The ndx init dinosaur animation shall base each frame after the first on a specific reference image or on an interpolation from Rex-F.png."},{"id":"c3","text":"While the ndx init dinosaur animation plays, it shall show only the corrected frame sequence and never fall back to the old incorrect frames."}]
source: "smart-add"
---

The ndx init dinosaur animation sequence is incorrect. Rex-F.png must be the canonical first frame, and each subsequent animation frame must be derived from the closest available reference image to Rex-F.png rather than being independently invented.
