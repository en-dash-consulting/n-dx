---
"@n-dx/rex": patch
---

Allow partial accept inside a recommendation group via
`rex recommend --accept=hashes:<hash>,<hash>,…`. Findings matching the listed
hash prefixes are filtered first; the recommendation tree is regenerated from
just those findings and accepted whole. Lets you keep the one valid finding
inside a noisy group without forcing acks on the rest or having to take the
group all-or-nothing.
