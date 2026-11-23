---
"@n-dx/sourcevision": patch
---

`ndx analyze --deep` now judges every typed finding and classifies every file on a large repository, instead of stopping when TypeSafe refuses a request as too large.

A request refused with `max_tokens_exceeded` is sent again as two halves, repeatedly, until each fits; one finding or file is never split across requests. An item still too large on its own keeps its derived severity (findings) or stays unclassified (files), with one warning giving the count. Any other TypeSafe failure behaves as before. The typed-finding summary line now counts only findings that were judged, as `N of M judged`, when some were not.
