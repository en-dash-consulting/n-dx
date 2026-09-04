# Isometric map: data sources and data-flow gaps

`sourcevision iso` renders `.sourcevision/iso-map.html` — a standalone isometric
view of the codebase. This document records exactly which analysis signals the
map consumes, which signals it wanted but could not get, and how to close each
gap if the map is ever asked to show real data flow rather than import structure.

It exists because the map is easy to over-read. A picture of blocks joined by
arrows looks like a runtime diagram. It is not one, and the difference matters
when someone uses it to reason about a production incident.

## What the map is built from

Every value in the scene comes from files already written by `sourcevision
analyze`. The command reads them and writes HTML; it runs no analysis of its own
and never mutates `.sourcevision/`.

| Visual property | Source | Field |
|---|---|---|
| One block per zone | `zones.json` | `zones[]` |
| Block footprint (w × d) | `zones.json` | `zones[].files.length` |
| Block height | `inventory.json` | Σ `files[].lineCount` over the zone's files |
| Block colour | `classifications.json` | dominant `files[].archetype` in the zone |
| Tests colouring | `inventory.json` | majority of `files[].role === "test"` |
| Column (dependency layer) | `zones.json` | longest path over `crossings[]` |
| Connector | `zones.json` | `crossings[]` aggregated to zone pairs |
| Connector thickness | `zones.json` | count of crossings in the pair |
| Panel: cohesion, coupling, risk | `zones.json` | `zones[].cohesion`, `.coupling`, `.riskMetrics` |
| Panel: insights | `zones.json` | `zones[].insights` |
| Panel: findings | `zones.json` | `findings[]` filtered by `scope` |
| Panel: key files | `zones.json` + `inventory.json` | `entryPoints` first, then largest by `lineCount` |
| Panel: route count | `components.json` | `serverRoutes[].routes` mapped to the owning zone |
| Dependency column | `imports.json` | `external[]` with ≥ 2 consuming zones |

`classifications.json` and `components.json` are optional. When either is
missing the map still renders and says so in its own footer — see *Self-declared
gaps* below.

## The second input path: direct scan

`--source=scan` skips `.sourcevision/` entirely and derives everything in one
pass over the file tree (`src/export/iso-scan.ts`). This is what lets the map
work on a repository that has never been analyzed, and it is the path the
portable `/iso-map` skill takes by default there.

| Visual property | Derived from |
|---|---|
| Zones | Directory structure: workspace containers (`packages/`, `apps/`, …), then source roots (`src/`, `lib/`, `internal/`, …) |
| Edges | Imports extracted by regex for JS/TS, Python and Go |
| Cohesion / coupling | Ratio of intra-zone to cross-zone edges |
| Block colour | Path conventions (`routes/` → entry, `models/` → data, …) |
| Dependency column | Non-relative specifiers, minus the standard library |

Three resolution details are worth knowing, because without them whole packages
look like third-party dependencies:

- **tsconfig `paths`** are read (including JSONC with comments and trailing
  commas), so `@app/core` resolves inside the repo.
- **Workspace packages** are mapped from each package's `name` in its
  `package.json` to its directory, so a monorepo's internal packages resolve.
- **Go** has no relative imports: `go.mod`'s `module` line is read so
  intra-module imports resolve to sibling packages rather than looking external.

Scan mode never produces findings, insights or risk levels — those only exist in
a real analysis — and it says so in the page footer.

## The gaps

### 1. Edges are imports, not data flow — partly closed

A connector means *this zone's files import that zone's files*. It does not mean
a request, a message, or a record travels along it. The two diverge constantly:

- A module can import a type and never call anything at runtime.
- A hot runtime path can cross a boundary with no import at all, via dependency
  injection or an event bus.
- Import direction is fixed at build time; control flow reverses through
  callbacks.

**Partly closed.** When `callgraph.json` is present, `aggregateCallEdges()` in
`src/export/iso-sources.ts` collapses its function-level edges to zone pairs and
attaches a call count to every connector. The page then offers a
**Weight: imports / calls** toggle that re-strokes the map by runtime calls
instead of imports, and an edge that exists *only* in the call graph — no import
resolves it — is drawn and labelled as such, which is the signature of an
injected or event-driven seam.

**Still open:** calls are resolved statically, so a dispatch through a variable,
a string key, or a registry is not counted; and the call graph says nothing
about volume at runtime, only about how many call sites exist in the source.

### 2. Injection seams point the wrong way, or not at all

n-dx uses callback injection at several tier boundaries (see the *Injection seam
registry* in `CLAUDE.md`). `web/src/server/start.ts` passes `broadcast`,
`loadPRD` and friends into `register-scheduler.ts`. Statically, `start.ts`
imports the scheduler; at runtime, the scheduler calls back into the server. The
map draws one arrow, in the build-time direction, and no arrow for the
runtime one.

**Closed, by declaration.** Seams are declared under
`sourcevision.isoMap.injectionSeams` in `.n-dx.json`:

```json
{
  "sourcevision": {
    "isoMap": {
      "injectionSeams": [
        {
          "from": "packages/web/src/server/start.ts",
          "to": "packages/web/src/server/task-usage.ts",
          "callbacks": ["broadcast", "loadPRD"],
          "note": "why this seam exists"
        }
      ]
    }
  }
}
```

`from` and `to` accept a zone id, a file path, or a directory prefix. A declared
seam is drawn in the direction control flows at *runtime* — the opposite of the
import — in a distinct colour and dot pattern, and its panel says plainly that
it was declared rather than inferred.

**Checked against the call graph.** A declaration is a claim, and a refactor can
leave the claim behind, so where `callgraph.json` exists `verifySeamCallbacks()`
looks for calls to each named callback on the receiving side:

| Outcome | Meaning | On the page |
|---------|---------|-------------|
| corroborated | at least one named callback is called in the receiving zone | drawn as before; the panel names the file and expression that matched each callback |
| unverified | a call graph was read and supports none of the named callbacks | drawn thinner, fainter and with a sparser dash; labelled *Unverified runtime seam*; the panel says the declaration is likely stale |
| unchecked | no call graph (scan mode), or no callbacks named | drawn as before, and the footer says the callbacks were taken on trust |

Evidence is searched across the whole receiving *zone*, not only the file the
declaration names, because a receiving module routinely hands the callbacks on
to a neighbour — n-dx's own scheduler seam names `task-usage.ts`, which passes
all four callbacks down to `usage-cleanup-scheduler.ts`, where they are actually
invoked. A qualified callee counts (`options.broadcast()` is a call to the
injected `broadcast`), which admits the odd coincidence — hence *corroborated*
rather than *proved*, with the matched file and expression shown so a reader can
judge. Callbacks nothing calls are also listed in the page footer, so a stale
declaration is visible without clicking every connector.

**Still open:** only seams somebody wrote down are drawn — an undeclared one
still points the wrong way. Verification is one-directional: it can find a
declaration the code no longer supports, but not a seam nobody declared. A
declaration that cannot be drawn — both ends in one zone, or a file no zone owns
— is reported in the page footer rather than silently dropped.

### 3. Runtime infrastructure is invisible

Queues, buckets, caches, databases, schedulers and cron jobs have no import
signature. A zone that talks to Postgres and a zone that talks to nothing look
identical unless a file in the zone happens to be named for the store. The
reference map that inspired this feature had first-class nodes for an S3 bucket,
two SQS queues and a dead-letter queue; none of those could be derived here.

**Closed, by declaration and by IaC.** Infrastructure now comes from two places
and is drawn as its own trailing column:

1. **Infrastructure-as-code.** `.tf` files are scanned for
   `resource "type" "name"` blocks; `.yaml`/`.yml` files are scanned for
   CloudFormation and SAM templates, recognised by a top-level `Resources:`
   block plus a namespaced `Type:` — a signal deliberately strict enough that a
   CI workflow or a k8s manifest is not mistaken for infrastructure.
   Types are classified by substring into buckets, queues, topics, databases,
   caches, streams, schedulers, secrets and compute; anything with no
   architectural meaning (an IAM role, a security group) is skipped. **One
   classification table serves both dialects**: `AWS::SQS::Queue` is normalised
   to `aws_sqs_queue` before matching, so a resource means the same thing
   whichever dialect declared it and there is no second table to drift. A
   resource is attributed to the zones whose source names it — a string match on
   the resource's own name literals (Terraform `name`-ish attributes,
   CloudFormation `BucketName`/`QueueName`/… properties, but never a `!Ref` or
   `!Sub`, which is not a name), with names shorter than five characters or too
   generic (`main`, `default`, `data`) refused outright.
2. **`.n-dx.json`**, under `sourcevision.isoMap.infrastructure`, for anything
   IaC does not cover — a managed service, another team's queue, a database that
   predates the repo:

```json
{ "id": "infra:jobs", "name": "jobs-queue", "kind": "queue",
  "usedBy": ["packages/hench/src/process"], "note": "async work" }
```

**Still open:** a string match is weaker evidence than an import, and the panel
says so. Infrastructure nothing on the map references is not drawn at all, since
a floating block asserts a relationship the map cannot support. Both parsers are
line scans, not full parsers, so a Terraform module, a nested stack, a YAML
anchor or anything behind `Fn::` indirection is out of reach. Pulumi and CDK are
not covered at all: their resources are expressed in a general-purpose language,
where a resource type is a constructor call rather than a declaration, and no
line scan finds those reliably.

### 4. Entry points are approximate

`zones[].entryPoints` means "file with no inbound intra-zone import", which is a
graph property, not a claim about how the system is invoked. Real entry points
are HTTP routes, CLI commands, queue consumers and scheduled jobs.

Partly closed already: `components.json` contributes `serverRoutes`, so a zone's
real HTTP surface is counted and shown in its panel. CLI commands and background
consumers are still missing — `classifications.json` labels files as
`cli-command` and `entrypoint`, which could be surfaced the same way.

### 5. Zones are a clustering result, not a design

Louvain community detection is non-deterministic across runs on a changed input
graph, and zones can merge, split or dissolve. The map inherits that: a zone
present today may be absent tomorrow, and `zones[].detectionQuality` marks some
as detection artifacts. Artifact zones are excluded from the scene outright,
since drawing a residual cluster as architecture would be a lie.

**To close it:** zone pinning in `.n-dx.json` already stabilises the important
zones. The map has no separate mechanism and does not need one.

### 6. External packages are a shallow slice

The dependency column shows third-party packages imported by at least two zones,
capped at five. It is a shared-surface indicator, not a dependency audit — it
says nothing about version, size, transitive weight or license.

## Self-declared gaps

The rendered page states its own limits in a footer section, and that list is
built from the data rather than hard-coded (`describeGaps()` in
`src/export/iso-model.ts`). If `classifications.json` is absent, the page says
colour has fallen back to a single kind; if no server routes were detected, it
says entry points are inferred. The three permanent gaps — imports ≠ data flow,
missing runtime infrastructure, and inverted injection seams — are always shown.

The intent is that the map can never be quoted without its caveats travelling
alongside it.

## Non-goals

- **Not a live view.** The map is a snapshot of the last analyze run. It has no
  connection to a running process.
- **Not a replacement for the dashboard.** `ndx start` serves the interactive,
  queryable view. The map is a single self-contained file made for reading and
  sharing, including offline and in a pull request.
- **Not generated by default.** `analyze` never writes it. It is a large
  generated HTML artifact, and putting it in every diff would be noise.
