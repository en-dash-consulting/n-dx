---
"@n-dx/web": patch
---

Stop `usePanZoom` producing a non-finite viewBox when its element measures zero.

Every gesture in the hook converts screen pixels into user-space units by dividing by the element's measured box, so a zero-sized box makes the scale `Infinity` — and `NaN` wherever the delta is also zero, since `0 * Infinity` is NaN. An ordinary vertical scroll has `deltaX: 0`, so the common case produced `NaN -Infinity 400 300`: that value goes straight into the rendered viewBox attribute, and because the bad value is *stored*, the surface stays broken after the element is sized again.

Zero-sized is narrower than it sounds — a `display:none` element cannot receive the event at all — but it is reachable: a container mid-collapse (this codebase animates exactly that in the codebase-map transition), a drag that begins while the element is sized and continues after it collapses, or a first interaction landing before layout settles.

Each handler now returns early when the box is unusable, rather than clamping the scale to something finite. Clamping would keep the gesture alive by inventing a magnitude — panning by a distance derived from an element size that does not exist. Doing nothing leaves the viewBox exactly as it was, and the next event once layout settles behaves normally. The wheel guard sits after `preventDefault` so a zero-sized surface still swallows the wheel instead of suddenly scrolling the page mid-animation.

The guard also covers the ctrl+wheel zoom branch, which divides by the same box for its cursor focal point. The hook previously had no test coverage at all; it now has nine, half of them pinning the normal-path arithmetic at two different element-to-viewBox ratios so the divisions are asserted rather than only the guard.
