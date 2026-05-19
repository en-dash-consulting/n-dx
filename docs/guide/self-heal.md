# Self-Heal Loop

The self-heal loop automates iterative codebase improvement: analyze, fix findings, verify fixes, repeat.

## Usage

```sh
ndx self-heal 3 .             # 3 improvement cycles (prompts for confirmation)
ndx self-heal .               # default: 1 cycle
ndx self-heal --capture-only .  # capture findings into PRD without executing
```

## How It Works

Each cycle runs five steps:

1. **Analyze** — Run SourceVision to scan the codebase for architectural findings
2. **Recommend** — Show actionable recommendations (zone-scoped, ≤3 findings/task)
3. **Accept** — Persist recommendations into the PRD as tagged tasks
4. **Execute** — Run Hench to fix the highest-priority task
5. **Acknowledge** — Mark completed tasks' findings as acknowledged so they don't regenerate

```
┌──────────────────────────────────────────────────────┐
│                  Self-Heal Cycle                     │
│                                                      │
│  analyze ──→ recommend ──→ accept ──→ work ──→ ack   │
│     ↑                                            │   │
│     └──────────────── repeat ────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

## Capture-Only Mode

`--capture-only` runs only steps 1–3 (analyze → recommend → persist to PRD) and then exits without invoking Hench. This is useful when you want to:

- **Preview** what self-heal would do before committing to autonomous execution
- **Triage** findings manually — review and reprioritize the generated PRD items before running
- **Audit** the codebase on a schedule without triggering unattended code changes
- **Populate the PRD** as a planning step in a multi-stage workflow

```sh
ndx self-heal --capture-only .
```

In capture-only mode:
- No LLM vendor is required (SourceVision analysis and Rex recommendation are vendor-neutral)
- The pre-execution confirmation prompt is skipped
- Generated PRD items carry the `self-heal-items` tag, same as normal mode
- Exit code 0 on success

After running capture-only, inspect the PRD with `ndx status`, then run `ndx work` or `ndx self-heal` to execute specific tasks.

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

## Skills used in this guide

Each skill below is invoked within each self-heal cycle. Edit the linked file in your project to customize that step's behavior in your assistant session.

| Skill | Source | Role in this guide |
|-------|--------|--------------------|
| `/ndx-plan` | [`.agents/skills/ndx-plan/SKILL.md`](./skills#ndx-plan) | Step 2 (Recommend): filters new actionable findings and proposes them as PRD tasks |
| `/ndx-work` | [`.agents/skills/ndx-work/SKILL.md`](./skills#ndx-work) | Step 3 (Execute): picks the highest-priority task and runs the tool-use loop to fix it |
| `/ndx-status` | [`.agents/skills/ndx-status/SKILL.md`](./skills#ndx-status) | Between cycles: surfaces remaining findings, completed tasks, and next recommended action |

Related guides: [Workflow](./workflow) (self-heal automates the full analyze → recommend → work loop), [Cleaning Up a Vibe-Coded App](./vibe-cleanup) (uses self-heal for ongoing post-cleanup improvement).

For the full skill inventory and customization guidance, see the [Skills Reference](./skills).
