---
"@n-dx/rex": patch
---

New `rex codeowners` generates `CODEOWNERS` and `.bitbucket/CODEOWNERS` from the product layer's stewards (root default, per-area override), one rule per area folder. Opt-in with `"codeOwners": true` in `.rex/config.json`; `--check` reports stale files. `@org/team` handles go to the GitHub file only, with a warning for the Bitbucket omission.
