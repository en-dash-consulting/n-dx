---
"@n-dx/hench": patch
---

Adversarial-review findings now carry an optional `disposition` (`fixed | dropped | offered | deferred`) and `reason`, recorded at the moment a finding's fate is decided, so a dropped or declined finding can be found downstream instead of surviving only in terminal scrollback. Records written before this field existed still load unchanged.
