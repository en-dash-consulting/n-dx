---
"@n-dx/rex": patch
"@n-dx/sourcevision": patch
"@n-dx/hench": patch
"@n-dx/core": patch
"@n-dx/llm-client": patch
---

Build rex's and sourcevision's LLM prompts through `PromptEnvelope` so their cost
is attributable per section rather than as one opaque total.

Every prompt in `rex/src/analyze/` and `sourcevision/src/analyzers/` is now
declared as a list of named sections against a shared per-package vocabulary,
with the paired `*Prompt` function reduced to an assembly call. Prompt text is
unchanged apart from removed doubled blank lines, where an absent conditional
block used to leave its own padding behind — pinned by `prompt-text-identity`
snapshot suites in both packages.

The section-measurement helpers (`promptSectionCosts`, `dominantPromptSections`,
`formatPromptSectionCosts`, `extractPromptSectionDiagnostics`) moved down to
`@n-dx/llm-client` so rex and sourcevision, which sit below hench and cannot
import from it, share one implementation instead of a copy; hench keeps only its
CLI rendering and reaches the rest through its existing gateway.

The prompt census now follows module-local helper calls when extracting static
prompt text. Factoring duplicated text into a helper previously dropped it from
the count entirely, so a refactor could silently shrink the baseline. Correcting
this raised the recorded totals ~5% with no prompt growing — the earlier figures
were an undercount — and the baseline records the revision so the jump is not
misread as a regression. The baseline also now reports a per-section breakdown
for each envelope-built package.
