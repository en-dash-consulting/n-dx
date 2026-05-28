---
"sourcevision": patch
---

Cut enrichment LLM cost and wall-clock without quality regression.

**Skip the LLM on structural-only zones.** Zones whose files are entirely
non-source (build scripts, assets, docs, config — `inventory.role !==
"source"` for every file) get a templated name and description derived
from their dominant role and top-level directory. On a typical small repo
this skips ~30–40 % of zones entirely (gotobed: 4 of 9 — Build & CI
Scripts, App Bundle Resources, Product Website, Project Root). Quality
loss is negligible because there's nothing for the LLM to analyze in
these zones beyond "which directory is this in" — the previous LLM
output was effectively the same templated paraphrase.

**Use Haiku for pass 1 (naming-dominant), Sonnet for pass 2+.** Pass 1's
job is mostly zone naming + initial observations; Haiku does that
accurately in roughly 1/3 the wall-clock of Sonnet and at a fraction of
the cost. Pass 2+ (cross-zone relationships, anti-patterns, suggestions)
stays on the standard model so analytical quality doesn't regress.
Respects `claude.lightModel` / `codex.lightModel` overrides in
`.n-dx.json` for users who want to pin a specific cheap model.
