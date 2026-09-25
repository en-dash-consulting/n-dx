---
"@n-dx/hench": patch
---

Adversarial-review findings now carry an optional `disposition` (`fixed | dropped | offered | deferred`) and `reason`, derived by the run from what the review pass actually did — `fixed` for a repair in the tree, `offered` for a finding captured as a PRD item, `dropped` for a `not-worth-fixing` verdict, and `deferred` for anything left undecided — so an unhandled finding can be found downstream instead of surviving only in terminal scrollback. Records written before this field existed still load unchanged.
