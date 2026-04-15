# Codebase Onboarding

You just cloned an unfamiliar codebase. This guide takes you from zero to a working architectural mental model in under 30 minutes using n-dx.

## The scenario

A large TypeScript monorepo. You don't know the zone structure, what's coupled to what, or where the hot paths are. You need a working overview before your first standup.

## Step 1: Initialize n-dx

```sh
cd your-project
ndx init .
```

This creates `.sourcevision/`, `.rex/`, and `.hench/` directories. No files are modified.

## Step 2: Run the analysis

```sh
ndx analyze .
```

SourceVision runs a six-phase pipeline:

1. **Inventory** — every file classified by type, language, and role
2. **Imports** — directed dependency graph from all import/require statements
3. **Classifications** — file archetypes (route-handler, service, utility, hook, etc.)
4. **Zones** — Louvain community detection clusters tightly-related files into named groups
5. **Components** — React component catalog with props and usage patterns
6. **Call graph** — function definitions and call edges across files

For a first look at an unfamiliar codebase, use the default analysis (AI enrichment on). It takes longer but produces named zones and human-readable descriptions.

If you need results fast (or have no API key yet):

```sh
ndx analyze --fast .    # skip AI enrichment, algorithmic only
```

You can always re-run with enrichment later. Incremental analysis caches unchanged files, so the second run is much faster.

## Step 3: Read CONTEXT.md and llms.txt

After analysis, two AI-readable summaries land in `.sourcevision/`:

### CONTEXT.md

Dense XML-tagged document optimized for Claude. Covers:

- File inventory summary (counts by language and role)
- Zone map with cohesion/coupling metrics
- Key architectural patterns detected
- Findings: anti-patterns, suggestions, risky zones

Open it and read it. It's the fastest way to get an architectural overview without clicking through files. A well-analyzed codebase will tell you its own story here.

### llms.txt

A flatter, Markdown-formatted version of the same data, following the [llms.txt standard](https://llmstxt.org/). Useful when pasting context into a model that doesn't have tool access. Both files are regenerated on every `ndx analyze` run.

**Practical tip:** Before your first conversation with the codebase, paste `CONTEXT.md` into your Claude session or reference it via the MCP tool. It gives the model a grounded starting point instead of generic guesses.

## Step 4: Explore the dashboard

Start the web dashboard to navigate the analysis visually:

```sh
ndx start .
```

Open `http://localhost:3117` in your browser. The dashboard has eight views:

| View | What to look at first |
|------|-----------------------|
| **Overview** | High-level zone count, file count, language breakdown |
| **Zones** | Zone map with cohesion/coupling scores — spot the hotspots |
| **Imports** | Directed import graph — find hubs and circular dependencies |
| **Files** | Full inventory with archetype classification |
| **Architecture** | Cross-zone dependency summary |
| **Problems** | All findings, filterable by type and severity |
| **Suggestions** | Improvement recommendations from AI enrichment |
| **Routes** | React route tree (if applicable) |

### Reading the zone map

Start with the **Zones** view. Each zone shows two metrics:

- **Cohesion** (0–1, higher is better): how much the zone's files import each other vs. the outside. A zone with cohesion < 0.4 has weak internal structure.
- **Coupling** (0–1, lower is better): how much the zone depends on things outside itself. Coupling > 0.6 means the zone is tightly woven into the rest of the codebase.

Risk levels:

| Label | What it means |
|-------|--------------|
| **healthy** | Both metrics within thresholds |
| **at-risk** | One metric is outside the threshold |
| **critical** | Both metrics are outside threshold |
| **catastrophic** | Cohesion < 0.3 AND coupling > 0.7 — refactoring urgently needed |

Focus your first review on `critical` and `at-risk` zones. These are the parts of the codebase most likely to cause pain when you make changes.

### Reading the import graph

Switch to the **Imports** view. Look for:

- **Hub files**: files with many incoming edges — anything that breaks here breaks many things
- **Long import chains**: deep dependency sequences — these become refactoring bottlenecks
- **Circular dependencies**: cycles flagged as findings — they constrain safe change order

The graph is interactive. Click a node to see all its imports and importers.

## Step 5: Set up MCP tools for interactive Q&A

The fastest way to explore architecture interactively is to give Claude Code direct access to the analysis data via MCP tools.

With the server running (`ndx start .`):

```sh
claude mcp add --transport http sourcevision http://localhost:3117/mcp/sourcevision
claude mcp add --transport http rex http://localhost:3117/mcp/rex
```

Now in any Claude Code conversation you can ask questions like:

- "Which files import from `auth-core`?" → use `sv_imports`
- "Show me all zones and their risk levels" → use `sv_zones`
- "What files are in the `payment-service` zone?" → use `sv_zones`
- "What's the full architecture context?" → use `sv_context`
- "Which React components use the `useAuth` hook?" → use `sv_components`

Available SourceVision MCP tools:

| Tool | Best for |
|------|----------|
| `sv_context` | Full architectural overview in one call |
| `sv_zones` | Zone map — where things live, how healthy they are |
| `sv_imports` | Dependency graph for a specific file |
| `sv_inventory` | File listing with classifications |
| `sv_components` | React component catalog |

**Practical workflow:** Open a Claude Code session. Call `sv_context` to load the codebase overview. Then ask specific questions about zones or files. The model now has grounded context and will give accurate answers instead of hallucinating structure.

### Sample Q&A session

```
You: Which zones are at risk or critical?
Claude: [calls sv_zones] The payment-processor zone has cohesion 0.28 and coupling 0.71 — critical. The api-gateway zone...

You: What files are in payment-processor?
Claude: [calls sv_zones with zone filter] 14 files including checkout.ts, stripe-adapter.ts, ...

You: What does stripe-adapter.ts import?
Claude: [calls sv_imports for stripe-adapter.ts] It imports from 3 external packages and 2 internal zones: ...
```

## Step 6: Generate an initial PRD

Once you have an architectural picture, turn SourceVision's findings into a structured work backlog:

```sh
ndx plan .
```

This runs analysis (if not already done) and then uses an LLM to propose a PRD from findings. You'll see proposed epics, features, and tasks. Review the proposals, then accept:

```sh
ndx plan --accept .
```

### What the baseline scan detects

When scanning an existing codebase for the first time (empty PRD + existing code), the LLM automatically performs a **baseline scan**: it marks already-implemented functionality as `completed` and only creates `pending` tasks for gaps, improvements, and missing features. You won't get a wall of pending tasks for code that already works.

### Reviewing the initial PRD

```sh
ndx status .
```

This shows the full PRD tree. At this point you'll typically see:

- A handful of epics organized by zone or architectural concern
- Features representing refactoring opportunities from anti-pattern findings
- Tasks for specific improvements (decouple X from Y, move file Z, etc.)

From here you can add your own items, reprioritize, and start working:

```sh
ndx add "Add rate limiting to the API gateway" .
ndx work --dry-run .    # preview what the agent would tackle first
ndx work .              # execute the next task
```

## Under 30 minutes: the fast path

If you need a working mental model quickly:

```sh
ndx init .                # 10 seconds
ndx analyze --fast .      # 2–5 minutes (no AI enrichment)
ndx start .               # 5 seconds
# Open http://localhost:3117 — read Zones and Imports views
# Open .sourcevision/CONTEXT.md — read the summary
ndx plan --accept .       # 3–5 minutes — PRD from findings
ndx status .              # see the backlog
```

Total: under 10 minutes to a structured overview and initial backlog. Spend the remaining 20 minutes in the dashboard exploring zones and asking questions via MCP.

For a deeper read — full AI enrichment, per-zone context files, complete call graph:

```sh
ndx analyze --full .
```

This runs all four AI enrichment passes and produces `zones/{zone-id}/context.md` files with per-zone architectural notes. Worth doing before any major refactoring work.

## What you'll have at the end

After following this guide you'll have:

- **A named zone map** — every file assigned to an architectural community, with health metrics
- **An import graph** — which zones depend on which, where the hubs are
- **A findings list** — anti-patterns, risky zones, circular dependencies, improvement suggestions
- **An initial PRD** — structured backlog generated from findings, with already-implemented items pre-marked complete
- **Interactive Q&A** — MCP tools configured so you can ask Claude Code architecture questions with grounded context

From here, the normal [workflow loop](./workflow) applies: analyze → recommend → work → status → repeat.
