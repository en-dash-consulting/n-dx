---
"@n-dx/rex": patch
---

`rex release stamp` under `rex.applyOn: release` applies a nested change before the change that holds it, so the container's amendment is the one left on the product layer. A steward apply (`rex change apply`, `apply_change`) of a container whose nested change is unapplied is refused, naming it. The released check runs two git commands however many unstamped changes have landed, instead of one `git tag --contains` per change.
