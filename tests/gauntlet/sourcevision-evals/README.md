# Sourcevision Eval Harness

Evaluation harness for sourcevision's LLM-driven analysis (zone enrichment, file classification).
Captures current `sv analyze` output as golden fixtures and scores future runs against them, so that
future token-reduction work (model swaps, heuristic-first classifiers, payload trimming,
skip-trivial-zones, etc.) can be validated as measured changes rather than vibes.

## Quick reference

```sh
pnpm gauntlet:evals           # run the eval gate against committed goldens
pnpm gauntlet:evals:record    # re-record goldens (use after intentional sourcevision changes)
pnpm gauntlet:evals:record -- --full    # record with LLM enrichment enabled (spends tokens)
```

## Layout

```
tests/fixtures/sv-evals/
  toy-app/              8-file fixture exercising 8 distinct archetypes, 1 zone
    src/...
    golden.json         committed golden snapshot
  medium-app/           31-file fixture with server/client/shared split, 6 zones
    src/...
    golden.json

tests/gauntlet/sourcevision-evals/
  record-goldens.js     recorder — runs sv analyze per fixture, writes golden.json
  score.js              scoring functions (archetype accuracy, zone partition similarity)
  score.test.js         scorer unit tests (runs under default `pnpm gauntlet`)
  evals.test.js         eval gate (runs only under `pnpm gauntlet:evals`)
  README.md             this file
```

## Running the gate

```sh
pnpm gauntlet:evals
```

For each fixture, the test:

1. Removes any existing `.sourcevision/` output directory
2. Runs `sv analyze --fast <fixture>` (algorithmic classification only, no LLM)
3. Reads the fresh `.sourcevision/classifications.json` and `.sourcevision/zones.json`
4. Scores each field against the committed `golden.json`
5. Asserts each score meets its floor (currently 1.0 for both scorers, both fixtures)

## Updating goldens

```sh
pnpm gauntlet:evals:record
```

Re-records goldens in `--fast` mode by default (deterministic, no LLM spend). The recorder:

1. Clears `.sourcevision/` in each fixture
2. Runs `sv analyze --fast <fixture>`
3. Snapshots only two fields per fixture:
   - per-file archetype assignment (from `classifications.json`)
   - zone partition by file membership (from `zones.json`)
4. Writes sorted, deterministic `golden.json` next to each fixture

Run this **only** after an intentional change to sourcevision's algorithmic output (new archetype
heuristic, zone-detection tweak, etc.) — inspect the diff before committing to make sure the change
matches what you expected.

### Recording with LLM enrichment

```sh
pnpm gauntlet:evals:record -- --full
```

Records goldens with full LLM enrichment. This spends real tokens. The recorder's mode is written
into `golden.json` under `recordedWith`, so you can tell at a glance which goldens came from which
mode.

If you switch goldens to `--full`, expect the eval gate floors (currently 1.0) to become
unachievable due to LLM nondeterminism on edge-case classifications. Adjust the floors in
`evals.test.js` and document the calibration in the commit.

## Why this is not part of default `pnpm gauntlet`

Each eval run spawns `sv analyze` against both fixtures — roughly a second of wall-clock per fixture
even in `--fast` mode, and real token spend in `--full` mode. Running it on every PR wastes CPU and
money on changes that don't touch sourcevision. `pnpm gauntlet` excludes `evals.test.js` explicitly
for this reason.

The scorer unit tests (`score.test.js`) are cheap pure-function tests and DO run under default
`pnpm gauntlet` — they protect the scoring logic itself.

## When to run the gate

- **When changing anything under `packages/sourcevision/src/analyzers/`, `src/classify/`, or
  `src/zones/`** — these affect what `sv analyze` outputs, which is what the gate measures.
- **When swapping the enrichment model** (Opus → Haiku, Anthropic → local) or tweaking prompts.
- **When adding/removing an archetype or changing archetype heuristics.**
- **When zone-detection behavior changes** (Louvain parameters, zone-pin policy, etc.).

If the gate fails on one of these changes, the failure itself is useful — it shows the exact
archetype or zone-boundary change your edit caused. Either (a) accept the change and re-record the
golden, or (b) refine the change until the gate passes at the existing floor.

## What's deliberately out of scope

- **CI integration** — not wired to any GitHub Actions job. Needs a cached LLM-replay layer before
  it's viable to run under `--full` in CI. Until then: run locally when changing sourcevision.
- **Semantic zone-name scoring** — zone names and descriptions are LLM-generated and not byte-stable,
  so the current harness ignores them. A future scorer could embed zone names and measure cosine
  similarity against goldens, but that's its own feature.
- **Cached LLM replay for deterministic `--full` runs** — would let `--full` goldens and `--full`
  eval runs stay deterministic. Tracked as part of the epic's follow-up task.

## Shape of `golden.json`

```jsonc
{
  "recordedWith": "fast",       // "fast" or "full" — matches the recorder flag used
  "svVersion": "0.1.0",         // sourcevision toolVersion at record time
  "files": [                    // sorted by path
    { "path": "src/...", "archetype": "component" },
    ...
  ],
  "zones": [                    // sorted by id; zone.files sorted alphabetically
    { "id": "client", "files": ["src/client/..."] },
    ...
  ]
}
```

The schema is intentionally minimal. Adding fields is fine — existing scorers ignore unknown keys —
but keep them deterministic or write a scorer that tolerates nondeterminism.

## Follow-up work (separate PRs, gated on this harness)

- Haiku swap for zone enrichment + classification with heuristic-first escalation
- Raise `MAX_CONCURRENT_ZONES` above 3; trim prompt payload (drop other-zone summaries, stop
  re-sending the archetype catalog per classify batch)
- Skip-trivial-zones short-circuit (single-file or single-archetype zones bypass the LLM)
- `--full` pass signature dedup (zones with unchanged structural signature reuse the previous
  enrichment result)
- Cached LLM replay for deterministic CI eval runs
- Semantic zone-name similarity scoring
