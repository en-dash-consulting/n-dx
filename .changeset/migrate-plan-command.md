---
"@n-dx/rex": patch
"@n-dx/core": patch
---

`ndx migrate --plan` (`rex migrate --plan`) writes the v1 → v2 migration plan to `.ndx-migration/plan.json` (gitignored; `--out` overrides, never inside the rex directory) and changes nothing in `.rex/`. Text placement and spec drafting run by default, Jev review only with a TypeSafe key, `--rules-only` runs none; a model pass that stops on an error is reported and the command exits non-zero after writing the plan. An epic filed by an adversarial review proposes no area.
