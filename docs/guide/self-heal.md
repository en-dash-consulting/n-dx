# Self-Heal Loop

The self-heal loop automates iterative codebase improvement: analyze, fix findings, verify fixes, repeat.

## Usage

```sh
ndx self-heal 3 .       # 3 improvement cycles
ndx self-heal .         # default: 1 cycle
```

## How It Works

Each cycle runs four steps:

1. **Analyze** — Run SourceVision to scan the codebase for architectural findings
2. **Recommend** — Accept new actionable recommendations into the PRD (anti-patterns, suggestions, move-files only)
3. **Execute** — Run Hench to fix the highest-priority task
4. **Acknowledge** — Mark completed tasks' findings as acknowledged so they don't regenerate

```
┌─────────────────────────────────────────┐
│              Self-Heal Cycle            │
│                                         │
│  analyze ──→ recommend ──→ work ──→ ack │
│     ↑                                 │ │
│     └─────────── repeat ──────────────┘ │
└─────────────────────────────────────────┘
```

## Actionable-Only Filtering

Self-heal uses `--actionable-only` to filter findings to types that represent concrete, fixable problems:

| Included | Excluded |
|----------|----------|
| `anti-pattern` — architectural violations | `observation` — metric descriptions ("Cohesion is 0.36") |
| `suggestion` — improvement recommendations | `pattern` — detected code patterns |
| `move-file` — file placement recommendations | `relationship` — dependency descriptions |

This prevents the agent from spending time on findings that describe metrics rather than problems.

## Fuzzy Acknowledgment

When the agent fixes a finding, the code change often alters zone structure — renamed zones produce conceptually identical findings with different text and different hashes. Without fuzzy matching, these appear as "new" findings and re-enter the PRD.

**How it works:**

1. **Exact match** (fast path) — check if the finding's hash matches any acknowledged finding
2. **Fuzzy match** — if no exact match, filter acknowledged findings to the same `type` and `scope`, then compare normalized text using bigram Dice similarity
3. **Threshold** — similarity >= 0.65 counts as a match (lower than SourceVision's 0.8 because cross-run text diverges more)

**Example:**
- Original finding: *"bidirectional coupling between game-engine and world-ui"*
- After fix: *"bidirectional coupling between game-engine and world-inventory-ui"*
- These share the same type (`anti-pattern`) and scope (`game-engine`) — fuzzy matching recognizes them as the same conceptual finding

## Finding Lifecycle

```
SourceVision finding
        ↓
  Rex recommend (shown to user or accepted into PRD)
        ↓
  Hench executes the task
        ↓
  Finding acknowledged (--acknowledge-completed)
        ↓
  Next scan: finding suppressed (exact or fuzzy match)
```

Acknowledged findings are stored in `.rex/acknowledged-findings.json` with their hash, text, type, and scope for fuzzy matching.
