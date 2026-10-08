---
"@n-dx/sourcevision": patch
---

Add the SDLC readiness scorecard, `analyzers/readiness-score.ts`.

Turns the `sdlc-profile.json` detections into a weighted score, keeping the shape of rex's PRD structure health (`packages/rex/src/core/health.ts`) so the dashboard can render repo readiness and PRD health with one component: dimensions scored 0-100, overall as the weighted sum, suggestions aimed at the weakest dimension.

- The nine weights — testing, ci, cd, rollback, migrations, featureFlags, qualityGates, observability, agentSafety — live in one exported `READINESS_WEIGHTS` constant. Nothing restates them, and the report order and the tie-break between equally weak dimensions are both read from it.
- Every dimension's `evidence` is carried through from the profile's own detections rather than recomputed, so a score traces back to the artifact the analyzer saw. A dimension with no evidence scores zero with a gap explaining the absence, rather than being credited for a section nobody looked at.
- Gaps are the useful output: `ReadinessGap.wouldRaiseScore` is required, so a gap that only complains does not compile.
- `agentSafety` reads `repo-trust` findings from `@n-dx/llm-client`, which is unchanged; it is injectable so scoring is a pure function of its inputs.

The scorecard is heuristic — it reports whether tests exist, run, and where the holes are, not whether they are good — and consumers must label it as such. Nothing is surfaced through the CLI, MCP or the dashboard yet.
