# SourceVision Analysis Deep Dive

How SourceVision analyzes your codebase: the pipeline, zone detection algorithm, findings system, and what you can configure.

## The Analysis Pipeline

SourceVision runs a 6-phase pipeline. Each phase builds on the previous one's output.

| Phase | Name | What it does |
|-------|------|-------------|
| 1 | **Inventory** | Scans all files, classifies by type, language, and role |
| 2 | **Imports** | Builds the directed dependency graph from import/require statements |
| 3 | **Classifications** | Assigns architectural archetypes to files (route-handler, service, utility, etc.) |
| 4 | **Zones** | Detects architectural communities via Louvain algorithm, then optionally enriches with AI |
| 5 | **Components** | Catalogs React components with props, usage patterns, and route detection |
| 6 | **Call Graph** | Maps function/method definitions and call edges across files |

Run specific phases with `--phase` or `--only`:

```sh
ndx analyze --phase zones .    # run only the zones phase
ndx analyze --only imports .   # run only the imports phase
```

### Incremental Analysis

Each phase detects whether its inputs have changed since the last run. Unchanged files are cached, and phases with stable inputs can be skipped entirely. This makes re-analysis fast after small changes.

## Zone Detection

Zones are the core architectural insight. SourceVision uses **Louvain community detection** on the import graph to discover natural clusters of tightly-related files.

### How Louvain Works

1. **Graph construction** -- The directed import graph is converted to an undirected weighted graph. Edge weight = number of imported symbols (minimum 1).

2. **Directory proximity** -- Light edges (weight 0.2) are added between adjacent files in the same directory. This helps convention-based frameworks (like Next.js or Remix) where directory layout defines architecture but files may not import each other directly.

3. **Modularity optimization** -- Louvain iteratively moves nodes between communities to maximize modularity. A resolution parameter (gamma) controls granularity: higher values produce smaller, tighter zones. Processing order is deterministic (sorted) for reproducibility.

4. **Post-processing** -- Several refinement passes clean up the raw communities:
   - **Bidirectional coupling merge**: Pairs of zones with >40% shared edges are merged
   - **Small zone absorption**: Zones with fewer than 3 files are absorbed into their most-connected neighbor
   - **Satellite merging**: Zones with <=8 files and >30% external coupling are merged into their dominant neighbor
   - **Large zone splitting**: Oversized zones are subdivided using progressively higher resolution, with directory-based fallback
   - **Zone count capping**: If there are too many zones, the weakest-connected pairs are merged

### Zone Metrics

Each zone gets two metrics computed from the import graph:

- **Cohesion** (0-1): Ratio of internal edges to total edges within the zone. Higher is better -- it means files in the zone import each other more than they import outside files.

- **Coupling** (0-1): Ratio of external edges to total edges. Lower is better -- it means the zone is relatively independent.

Single-file zones have trivially perfect cohesion (1.0). Zones with fewer than 5 files have unreliable metrics and are treated as informational only.

### Risk Assessment

Zones are classified by their metric health:

| Risk Level | Condition |
|------------|-----------|
| **healthy** | Both metrics within thresholds |
| **at-risk** | One metric outside thresholds |
| **critical** | Both metrics outside thresholds |
| **catastrophic** | Cohesion < 0.3 AND coupling > 0.7 |

Default thresholds: cohesion floor 0.4, coupling ceiling 0.6. These are overridden per zone type (see [Configuration](#zone-types) below).

## Findings

SourceVision produces findings from two sources: deterministic analysis (always runs) and AI enrichment (optional).

### Finding Types

| Type | Description | Actionable? |
|------|-------------|-------------|
| `anti-pattern` | Architectural violations, circular deps, high coupling | Yes |
| `suggestion` | Improvement recommendations, naming issues | Yes |
| `move-file` | Concrete file relocation proposals | Yes |
| `observation` | Metric descriptions ("Cohesion is 0.36") | No |
| `pattern` | Detected architectural patterns | No |
| `relationship` | Cross-zone dependency descriptions | No |

Use `ndx recommend --actionable-only` to filter to only the first three.

### Algorithmic Findings (Always Run)

These are deterministic and reproducible -- no AI involved:

- **Risk scoring**: Zones with low cohesion or high coupling are flagged
- **God functions**: Functions with unusually high outgoing call count
- **Tightly coupled modules**: Files with excessive cross-zone call edges
- **Unused exports**: Exported symbols with no incoming calls
- **Hub functions**: Functions called from many locations
- **Fan-in hotspots**: Files that are popular callers

### AI Enrichment (Optional)

When AI enrichment runs, it makes multiple passes over the zone data:

| Pass | Focus | Finding Types |
|------|-------|--------------|
| 1 | Zone naming, descriptions, initial observations | observation |
| 2 | Cross-zone relationships, clean boundaries, leaky abstractions | pattern, relationship |
| 3 | Anti-pattern detection, tight coupling, missing abstractions | anti-pattern |
| 4 | Naming inconsistencies, risk areas, refactoring opportunities | suggestion |

Control enrichment with CLI flags:

```sh
ndx analyze .              # default: 1-2 enrichment passes
ndx analyze --fast .       # skip AI enrichment entirely (algorithmic only)
ndx analyze --full .       # run all 4 enrichment passes
ndx analyze --per-zone .   # per-zone enrichment (smaller context per call)
```

The `--per-zone` mode sends each zone individually to the LLM (max 3 concurrent) instead of batching 5 zones per call. Better for large codebases or budget-constrained runs.

#### Incremental Enrichment

SourceVision computes content hashes per zone. If a zone's files haven't changed since the last enrichment, the LLM call is skipped and previous names/descriptions are preserved. This makes re-enrichment cheap after small changes.

## Configuration

### Zone Types

Annotate zones with an architectural role to apply type-specific risk thresholds:

```sh
ndx config sourcevision.zones.types.my-zone domain .
```

Or in `.n-dx.json`:

```json
{
  "sourcevision": {
    "zones": {
      "types": {
        "api-routes": "integration",
        "auth-core": "domain",
        "test-helpers": "test"
      }
    }
  }
}
```

Available types and their thresholds:

| Type | Cohesion Floor | Coupling Ceiling | Rationale |
|------|---------------|-----------------|-----------|
| `domain` | 0.4 | 0.6 | Strict -- core business logic should be well-encapsulated |
| `integration` | 0.2 | 0.8 | Relaxed -- integration code naturally touches many things |
| `test` | 0.1 | 0.9 | Permissive -- test files import widely by design |
| `infrastructure` | 0.0 | 1.0 | No expectations -- config, build tooling, etc. |
| `gateway` | 0.1 | 0.9 | High coupling expected -- gateways bridge packages |
| `orchestration` | 0.2 | 0.8 | Wiring code -- moderate coupling expected |

### Zone Pins

Override Louvain's zone assignment for specific files:

```json
{
  "sourcevision": {
    "zones": {
      "pins": {
        "src/utils/special-helper.ts": "core-domain"
      }
    }
  }
}
```

Pins take precedence over algorithmic detection. Useful when Louvain misclassifies a file due to sparse import edges.

### Project Hints

Create `.sourcevision/hints.md` with context for the AI enrichment:

```md
## Architecture Notes

- The `api/` directory follows REST conventions -- each file is one resource.
- `shared/` is a catch-all utility zone; low cohesion is expected and acceptable.
- Zone names should reflect business domains, not technical layers.
```

This file is included in every LLM enrichment prompt, helping the AI produce more accurate zone names and insights.

### Custom Archetypes

SourceVision ships with 40+ built-in file archetypes (route-handler, service, utility, hook, etc.). Add custom ones or override per-file:

```json
{
  "sourcevision": {
    "archetypes": {
      "custom": [
        {
          "id": "saga",
          "signals": ["*.saga.ts", "function* "],
          "description": "Redux saga file"
        }
      ],
      "overrides": {
        "src/legacy/weird-file.ts": "utility"
      }
    }
  }
}
```

### Risk Justifications

If a zone is flagged as risky but you've accepted the trade-off, add a justification to downgrade findings to informational:

```json
{
  "sourcevision": {
    "riskJustifications": [
      {
        "zone": "shared-utils",
        "reason": "Intentional catch-all -- 3 files, metrics unreliable at this size"
      }
    ]
  }
}
```

Zone type annotations (above) are preferred over justifications -- they're simpler and automatically apply the right thresholds.

## Output Files

All output is written to `.sourcevision/`:

| File | Contents |
|------|----------|
| `manifest.json` | Analysis metadata, module status, token usage |
| `inventory.json` | File catalog (path, size, role, category, language) |
| `imports.json` | Directed import graph, external dependencies, circular dependency detection |
| `classifications.json` | File-to-archetype mappings |
| `zones.json` | Zone boundaries, cohesion/coupling metrics, findings, enrichment metadata |
| `components.json` | React component catalog with props and usage edges |
| `callgraph.json` | Function/method definitions and call edges |
| `llms.txt` | Structured Markdown summary for LLM consumption |
| `CONTEXT.md` | Dense XML-tagged summary optimized for Claude |
| `zones/{zone-id}/context.md` | Detailed per-zone context |
| `zones/{zone-id}/summary.json` | Per-zone metadata and risk metrics |

## Determinism

The algorithmic analysis (phases 1-6 without AI enrichment) is fully deterministic: same codebase produces identical output. All tie-breaking in the Louvain algorithm is lexicographic.

AI enrichment introduces variation because LLM responses are non-deterministic. Zone names may differ slightly across runs, but the underlying zone boundaries (file assignments) are stable.
