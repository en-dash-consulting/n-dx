## llm-client injection seam registry

`@n-dx/llm-client` is the foundation tier: it may not import from rex,
sourcevision, hench or web. Where a consumer needs this package to feed
something upward — accounting, telemetry, a ledger — the dependency is inverted
into a callback the consumer registers. Those seams are invisible to static
analysis (`domain-isolation.test.js` sees no edge at all), so they are listed
here.

| Seam | Registrar | Target | Interface |
|------|-----------|--------|-----------|
| Jev per-call accounting | `packages/sourcevision/src/cli/commands/analyze.ts` (`initAndLoadLLMConfig`, beside `configureJudgmentCache`) | `src/jev-client.ts` (`askJev`) | `JevObserver` — `onCall(JevCallRecord)`, `onCacheStats(hits, misses)` |

`initAndLoadLLMConfig` is the bootstrap both `sv analyze` (`cmdAnalyze`) and
`sv narrate` run — narrate reaches it through `narrateDeps().bootstrap` — so
registering there is what keeps either command's ledger from losing Jev calls.
Registering in `cmdAnalyze` instead would silently drop narrate's.

Contract test: `packages/sourcevision/tests/integration/seam-jev-observer.test.ts`.

### Rules

- **Every callback stays optional.** A consumer with no ledger registers
  nothing, and the target must work unobserved. rex will be such a consumer of
  `askJev` before it has a ledger of its own.
- **A new callback needs a new row above and a case in the contract test** —
  runtime invocation *and* optional-callback safety both. See TESTING.md,
  "Co-evolution Rule: Seam Registry and Gateway Table".
- **Prefer widening the observer interface over an upward import.** There is no
  import of an upper tier that would be correct from this package.

### Jev observer specifics

- **Only successful calls reach `onCall`.** A failed call would put a
  zero-token bucket in sourcevision's ledger, which `priceRunLedger` reads as an
  unknowable total and turns into a missing `costUsd` for the whole run.
- **`onCacheStats` fires only while the judgment cache is configured.** An
  unconfigured cache reports every question as a miss it never stores; recording
  that would show a 0% hit rate for runs that never had a cache.

## Judgment cache directory

`configureJudgmentCache({ svDir })` takes the directory from its caller and
writes `<svDir>/.cache/judgments.json`. The parameter is named for
sourcevision's `.sourcevision/` because that is today's only caller, but this
package holds no opinion about where a consumer keeps state — do not hard-code a
path here when a second consumer arrives.
