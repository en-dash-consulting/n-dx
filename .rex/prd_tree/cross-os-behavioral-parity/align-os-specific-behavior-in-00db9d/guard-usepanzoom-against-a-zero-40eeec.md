---
id: "40eeec53-394a-43d9-9ec5-b971669fc744"
level: "task"
title: "Guard usePanZoom against a zero-sized element, and give the hook its first test"
status: "pending"
priority: "low"
tags:
  - "web"
  - "viewer"
  - "robustness"
  - "test-coverage"
acceptanceCriteria:
  - "handleWheel and movePan cannot produce a non-finite viewBox when the measured element box is zero"
  - "A test drives the zero-size path directly and asserts the viewBox stays finite — with getBoundingClientRect stubbed, since jsdom reports 0x0 for everything"
  - "At least one test covers the normal path with a stubbed non-zero box, so the pan arithmetic is asserted rather than only the guard"
  - "The decision on early-return vs clamping is recorded with its reasoning"
description: "usePanZoom divides by the element's measured box in three places, with no guard against that box being zero:\n\n  packages/web/src/viewer/hooks/use-pan-zoom.ts\n    handleWheel: const scaleX = vb.w / rect.width;   const scaleY = vb.h / rect.height;\n    movePan:     const scaleX = viewBox.w / rect.width; const scaleY = viewBox.h / rect.height;\n\nWhen rect.width/height is 0, scale is Infinity, and `vb.x + delta * Infinity` is ±Infinity — or NaN when delta is 0, since 0 * Infinity is NaN. That value goes straight into the rendered viewBox attribute, so the surface can blank out or freeze rather than degrade.\n\nHOW LIKELY, honestly: narrow but not impossible. A display:none element cannot receive a wheel event, so the obvious case is out. The realistic ones are a container mid-collapse (this codebase animates exactly that — see the ig-codebase-morph mini/full transition), a drag that starts while the element is sized and continues after it collapses, and a first interaction that lands before layout has settled. Not a crash users are hitting today; a cheap guard against a class of bug that is very hard to diagnose from a bug report.\n\nSUGGESTED FIX: bail out when the measured box is not usable — `if (!rect.width || !rect.height) return;` in handleWheel and movePan — or clamp the scale to a finite value. Returning early is the honest behaviour: with no geometry there is no meaningful pan distance to compute.\n\nWHY THIS IS FILED SEPARATELY: found while fixing 3be5b199 (web's two graph-view failures). That task's stated mechanism was that these divisions caused the failures, since jsdom's getBoundingClientRect returns 0x0. That turned out to be wrong — usePanZoom is not on the graph view's code path at all; graph.ts has its own pan/zoom using svg.viewBox.baseVal, which jsdom implements correctly. So this is a real robustness gap that the earlier triage happened to surface, not the cause of anything currently red.\n\nALSO WORTH KNOWING: usePanZoom has NO test coverage whatsoever — grep across packages/web/tests finds no reference to the hook or its file. Its two consumers are views/merge-graph.ts and views/zones.ts. Testing it directly needs a getBoundingClientRect stub, because jsdom reports 0x0 for every element; a stub with an explicit width/height makes the pan arithmetic derivable rather than coincidental."
---
