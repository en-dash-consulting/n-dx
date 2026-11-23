---
"@n-dx/sourcevision": patch
---

`ndx analyze --deep` now sizes TypeSafe judgment requests to fit before sending them, and judges a finding too large on its own on trimmed evidence instead of skipping it.

Typed-finding and Jev classification batches are packed so each request stays under a byte ceiling (128 KiB by default) as well as the existing count cap; set `sourcevision.jev.requestByteCeiling` in the project config to change it. A request still refused as too large is split in halves as before. A typed finding refused on its own is asked again with fixed cuts to its evidence (file headers, then declarations and exported symbols, then the file sample, then its edges); no model summarizes it. The summary line counts findings judged on trimmed evidence, and the too-large warning counts only those refused at every level. Runs whose requests already fit are unchanged.
