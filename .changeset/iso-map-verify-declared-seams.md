---
"@n-dx/sourcevision": patch
---

Check declared injection seams against the call graph on the isometric map. A seam declared under `sourcevision.isoMap.injectionSeams` was previously drawn on trust, so a refactor could leave the declaration behind and the map would keep asserting a relationship nothing invokes. Where `callgraph.json` is available, each named callback is now looked for on the receiving side: a corroborated seam's panel names the file and expression that matched, a seam the call graph does not support is drawn thinner and fainter with a sparser dash and labelled "unverified", and callbacks nothing calls are listed in the page footer. A view with no call graph reports the seams as unchecked rather than marking them unverified.
