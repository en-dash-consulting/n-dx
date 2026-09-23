---
"@n-dx/sourcevision": patch
---

Lead Next Steps and Problems titles with plain language, not the metric.

Findings and their Next Step titles read metric-first — "Zone X has critical
risk (score: 0.65, cohesion: 0.30, coupling: 0.70) — requires refactoring…",
"N zones exceed architectural risk thresholds (cohesion < 0.4, coupling > 0.6):
…", "Low cohesion (0.2) — files are loosely related…" — and the 80-character
title truncation could cut a title off mid-metric, hiding the explanation. An
outside first-use review could not tell what a finding meant without opening
its detail.

- Architectural-risk findings (`risk-scoring.ts`) now lead with the problem
  ("Zone X is fragile and needs refactoring before new feature development",
  "N zones are fragile: they hold loosely related files and depend heavily on
  other zones") and put the cohesion, coupling and score numbers after an
  em-dash. The Problems view, CONTEXT.md and llms.txt show this new wording.
- Next Step titles drop any trailing metric clause after an em-dash, and
  strip a leading "<Metric label> (<value>) —" or "<Metric label>:" prefix
  from findings that still start with one, so a title is plain language even
  when truncated. The full finding text, metric included, is still the Next
  Step's description.
- A grouped Next Step states its count first ("2 related findings: …")
  instead of appending "(+N related)".

The findings and next-steps JSON shapes, and the CONTEXT.md and llms.txt
section structure, are unchanged; only wording changed. Anything that matched
on the old risk-finding wording should match on the new text.
