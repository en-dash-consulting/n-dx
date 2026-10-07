/**
 * Infrastructure discovery: the parts of a system that static analysis cannot see.
 *
 * Two things the import graph structurally cannot show, and how they get in:
 *
 *   1. **Injection seams.** When `start.ts` passes `broadcast` into
 *      `register-scheduler.ts`, the import points one way and the runtime call
 *      points the other. Static analysis sees only the import, so a map drawn
 *      from imports shows an arrow that is backwards for the behaviour people
 *      care about. Seams have to be declared; they are read from `.n-dx.json`.
 *
 *   2. **Runtime infrastructure.** A queue, bucket, cache or database has no
 *      import signature at all. It is discovered from infrastructure-as-code
 *      where that exists, and otherwise declared in `.n-dx.json`.
 *
 * Both are *claims made by a human or by IaC*, not inferences, and consumers
 * label them as such — a declared seam is only as accurate as its declaration.
 *
 * ## Why this is an analyzer
 *
 * This knowledge used to live in `export/iso-declared.ts`, which meant it
 * existed only inside a generated iso-map HTML page and nothing else could
 * read it. It is discovered at analyze time now and persisted as
 * `infrastructure.json`, so any consumer can have it. The iso export reads
 * that file instead of recomputing; the logic below is the same logic, moved.
 *
 * ## Two constraints on what this module may import
 *
 * It bundles into the standalone iso-map skill script, which must run in any
 * repository with no dependencies, so **only `node:` builtins and type-only
 * imports** may appear here. That is also why serialization is not done here:
 * canonical JSON comes from `util/sort.ts`, which re-exports it from
 * `@n-dx/llm-client`, and importing that would pull a package into the
 * bundle. The analyze pipeline writes the file; this module only computes the
 * data and converts between its in-memory and persisted shapes.
 *
 * @module sourcevision/analyzers/infrastructure
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, sep } from "node:path";
import { DATA_FILES } from "../schema/data-files.js";
import type { InfraLink, InfraResource, InfrastructureData } from "../schema/v1.js";

// ── Folder layout ───────────────────────────────────────────────────────────

/**
 * The `.ndx/` container for a project root, or `null` on the legacy layout.
 *
 * Hand-written twin of `resolveLayout(root).container`. This module bundles
 * into the standalone skill script and may import nothing but `node:`
 * builtins, so it cannot reach the resolver in `@n-dx/llm-client` — the same
 * constraint that gives `packages/core/layout.js` its own copy.
 * `tests/integration/layout-resolver-contract.test.js` pins what is built on
 * it to the canonical implementation, because a third copy of a rule drifts
 * just as silently as a second one.
 *
 * It lives here rather than beside `analysisDirFor` in `iso-sources.ts`
 * because the bundle imports in that direction: `iso-sources` reads this
 * module, so a helper placed there could not be reused from here.
 */
export function ndxContainer(root: string): string | null {
  const container = join(root, ".ndx");
  try {
    return statSync(container).isDirectory() ? container : null;
  } catch {
    return null;
  }
}

/**
 * The project config file for a root, on either folder layout.
 *
 * Twin of `resolveLayout(root).configFile`. Reading `.n-dx.json` verbatim on
 * a project with `.ndx/` finds nothing, and declared seams and infrastructure
 * are claims a human made — dropping them silently redraws the map as if the
 * declaration had never been written.
 */
export function projectConfigFor(root: string): string {
  const container = ndxContainer(root);
  return container ? join(container, "config.json") : join(root, ".n-dx.json");
}

// ── Types ───────────────────────────────────────────────────────────────────

/** A runtime control-flow edge that inverts, or has no, import. */
export interface DeclaredSeam {
  /** Zone id, or a file path that resolves to one. */
  from: string;
  /** Zone id, or a file path that resolves to one. */
  to: string;
  /** The callbacks or events crossing the seam. */
  callbacks?: string[];
  /** Why this seam exists. */
  note?: string;
}

/** Infrastructure a zone talks to that has no import signature. */
export interface DeclaredInfra {
  id: string;
  name: string;
  /** Coarse category, used for the panel copy. */
  kind: string;
  /** Zone ids or path prefixes that use it. */
  usedBy?: string[];
  note?: string;
  /** Where this came from: a config entry, or the IaC file that declared it. */
  origin: "config" | string;
  /**
   * Name literals to look for in source when attributing this resource to
   * zones — the IaC local name plus any `name`-ish attribute. Internal to
   * discovery and linking; not something a config author writes.
   */
  literals?: string[];
}

export interface DeclaredArchitecture {
  seams: DeclaredSeam[];
  infrastructure: DeclaredInfra[];
  /** True when IaC files were found, whether or not anything was linked. */
  sawIaC: boolean;
}

// ── Config ──────────────────────────────────────────────────────────────────

interface NdxConfigShape {
  sourcevision?: {
    isoMap?: {
      injectionSeams?: DeclaredSeam[];
      infrastructure?: Array<Omit<DeclaredInfra, "origin">>;
    };
  };
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

/** Read declared seams and infrastructure from the project config. */
export function readDeclaredConfig(root: string): {
  seams: DeclaredSeam[];
  infrastructure: DeclaredInfra[];
} {
  const config = readJson<NdxConfigShape>(projectConfigFor(root));
  const isoMap = config?.sourcevision?.isoMap;
  if (!isoMap) return { seams: [], infrastructure: [] };

  const seams = (isoMap.injectionSeams ?? []).filter(
    (s): s is DeclaredSeam => Boolean(s && typeof s.from === "string" && typeof s.to === "string"),
  );

  const infrastructure = (isoMap.infrastructure ?? [])
    .filter((i) => i && typeof i.id === "string" && typeof i.name === "string")
    .map((i) => ({ ...i, kind: i.kind || "service", origin: "config" as const }));

  return { seams, infrastructure };
}

// ── Infrastructure-as-code discovery ────────────────────────────────────────

/**
 * Resource type → coarse kind, for every IaC dialect.
 *
 * Matched as substrings against the resource type so this stays useful across
 * AWS, GCP and Azure without enumerating every provider's naming.
 *
 * One table, not one per parser: the patterns are written in Terraform's
 * underscore form and `classifyResource` normalizes the other dialects into it
 * (`AWS::SQS::Queue` → `aws_sqs_queue`). Two tables would disagree within a
 * release — which is how the skill script and the package came to disagree
 * about zone colours.
 */
const IAC_KINDS: Array<[RegExp, string]> = [
  [/bucket|blob_container|storage_account/, "bucket"],
  [/sqs|_queue|servicebus_queue|pubsub_subscription/, "queue"],
  [/sns|pubsub_topic|eventgrid|event_bus|eventbridge/, "topic"],
  [/dynamodb|rds|_sql|spanner|firestore|bigtable|cosmosdb|documentdb|database/, "database"],
  [/elasticache|redis|memcache/, "cache"],
  [/kinesis|kafka|msk|firehose/, "stream"],
  [/cloudwatch_event_rule|events_rule|scheduler|cron|eventbridge_rule/, "scheduler"],
  [/secret|kms|vault|parameter/, "secrets"],
  [
    /lambda_function|serverless_function|cloud_run|cloudfunctions|container_app/,
    "compute",
  ],
];

/**
 * Classify a resource type from any dialect.
 *
 * CloudFormation's `AWS::SQS::Queue` and Terraform's `aws_sqs_queue` describe
 * the same thing, so the separator is normalized and the one table decides.
 */
function classifyResource(type: string): string | null {
  const normalized = type.toLowerCase().replace(/::/g, "_").replace(/-/g, "_");
  for (const [pattern, kind] of IAC_KINDS) {
    if (pattern.test(normalized)) return kind;
  }
  return null;
}

const IAC_SKIP = new Set([
  "node_modules", ".git", ".terraform", "dist", "build", "vendor", "coverage",
]);

/**
 * Find IaC candidate files in one pass over the tree.
 *
 * Terraform and YAML get separate budgets. A repository holds far more YAML
 * than Terraform — CI workflows, k8s manifests, lockfiles — and a shared budget
 * would let that noise crowd out the `.tf` files before they were reached.
 */
function findIaCFiles(root: string, limit = 400): { terraform: string[]; yaml: string[] } {
  const terraform: string[] = [];
  const yaml: string[] = [];
  function walk(dir: string, depth: number): void {
    if (depth > 8 || (terraform.length >= limit && yaml.length >= limit)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IAC_SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(full, depth + 1);
        continue;
      }
      const ext = extname(entry.name);
      const path = relative(root, full).split(sep).join("/");
      if (ext === ".tf" && terraform.length < limit) terraform.push(path);
      else if ((ext === ".yaml" || ext === ".yml") && yaml.length < limit) yaml.push(path);
    }
  }
  walk(root, 0);
  return { terraform, yaml };
}

const TF_RESOURCE = /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;
/** A `name`-ish attribute inside a resource block, used to match code literals. */
const TF_NAME_ATTR = /^\s*(?:name|bucket|queue_name|topic_name|function_name|identifier|table_name)\s*=\s*"([^"]+)"/gm;

/** The top-level `Resources:` key that opens a template's resource block. */
const CFN_RESOURCES = /^Resources:\s*$/m;
/** `LogicalName:` at the indent resources sit on. */
const CFN_LOGICAL = /^(\s+)([A-Za-z0-9]+):\s*$/;
/** `Type: AWS::SQS::Queue`, quoted or not. */
const CFN_TYPE = /^\s*Type:\s*['"]?([A-Za-z0-9]+::[A-Za-z0-9:-]+)['"]?\s*$/;
/** A `name`-ish property, used to match code literals. */
const CFN_NAME_PROP =
  /^\s*(?:Name|BucketName|QueueName|TopicName|FunctionName|TableName|DBInstanceIdentifier|StreamName|ClusterName)\s*:\s*['"]?([^'"\n]+?)['"]?\s*$/;

/**
 * Is this YAML a CloudFormation template?
 *
 * A repository is mostly YAML that is not infrastructure — CI workflows, k8s
 * manifests, lockfiles — and treating one as a template would invent
 * infrastructure and flip the "this project has IaC" flag that decides which
 * caveat the page shows. Requiring both a top-level `Resources:` block and a
 * namespaced `Type:` is cheap and, in practice, conclusive.
 */
function isCloudFormation(content: string): boolean {
  return CFN_RESOURCES.test(content) && /^\s*Type:\s*['"]?[A-Za-z0-9]+::/m.test(content);
}

/**
 * Read resources out of a CloudFormation template.
 *
 * A line scan rather than a YAML parse, for the same reason the Terraform side
 * reads resource blocks rather than state: no dependency, and it finds what a
 * reader would see scanning the file. Anchors, nested stacks and `Fn::`
 * indirection are out of reach, and that is the documented limit.
 */
function parseCloudFormation(content: string, file: string): DeclaredInfra[] {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((l) => CFN_RESOURCES.test(l));
  if (start === -1) return [];

  const found: DeclaredInfra[] = [];
  let baseIndent: number | null = null;
  let current: { name: string; literals: Set<string>; type?: string } | null = null;

  const flush = (): void => {
    if (!current?.type) return;
    const kind = classifyResource(current.type);
    if (!kind) return; // nothing the map has anything useful to say about
    found.push({
      id: `infra:${current.type}.${current.name}`,
      name: current.name,
      kind,
      usedBy: [],
      note: `${current.type} declared in ${file}`,
      origin: file,
      literals: [...current.literals].sort(),
    });
  };

  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) break; // a new top-level key ends the Resources block

    const logical = CFN_LOGICAL.exec(line);
    if (logical && (baseIndent === null || logical[1].length === baseIndent)) {
      baseIndent = logical[1].length;
      flush();
      current = { name: logical[2], literals: new Set([logical[2]]) };
      continue;
    }
    if (!current) continue;

    const type = CFN_TYPE.exec(line);
    if (type) {
      current.type = type[1];
      continue;
    }
    const prop = CFN_NAME_PROP.exec(line);
    // An intrinsic function is not a name: matching source against
    // "!Sub '${AWS::StackName}-docs'" would attribute the resource to nothing.
    if (prop && !prop[1].startsWith("!") && !prop[1].includes("Fn::")) {
      current.literals.add(prop[1].trim());
    }
  }
  flush();

  return found;
}

/**
 * Discover infrastructure from infrastructure-as-code.
 *
 * Deliberately shallow: it reads resource declarations, not state, modules or
 * deployed stacks, so it finds what a reader would see scanning the files
 * themselves. Terraform and CloudFormation both feed the same classification
 * table, so a resource means the same thing whichever dialect declared it.
 */
export function discoverFromIaC(root: string): { infrastructure: DeclaredInfra[]; sawIaC: boolean } {
  const { terraform, yaml } = findIaCFiles(root);
  if (terraform.length === 0 && yaml.length === 0) {
    return { infrastructure: [], sawIaC: false };
  }

  const infrastructure: DeclaredInfra[] = [];
  const seen = new Set<string>();
  const add = (entry: DeclaredInfra): void => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    infrastructure.push(entry);
  };

  const read = (file: string): string | null => {
    try {
      const full = join(root, file);
      // A multi-megabyte YAML is a lockfile or a fixture, not a template.
      if (statSync(full).size > 1_000_000) return null;
      return readFileSync(full, "utf-8");
    } catch {
      return null;
    }
  };

  for (const file of terraform) {
    const content = read(file);
    if (content === null) continue;

    TF_RESOURCE.lastIndex = 0;
    let match;
    while ((match = TF_RESOURCE.exec(content)) !== null) {
      const [, type, localName] = match;
      const kind = classifyResource(type);
      if (!kind) continue; // not a resource the map has anything useful to say about

      // Literal names inside the block give us something to match in code.
      const block = content.slice(match.index, match.index + 800);
      TF_NAME_ATTR.lastIndex = 0;
      const literals = new Set<string>([localName]);
      let attr;
      while ((attr = TF_NAME_ATTR.exec(block)) !== null) literals.add(attr[1]);

      add({
        id: `infra:${type}.${localName}`,
        name: localName,
        kind,
        usedBy: [],
        note: `${type} declared in ${file}`,
        origin: file,
        literals: [...literals].sort(),
      });
    }
  }

  let sawTemplate = false;
  for (const file of yaml) {
    const content = read(file);
    if (content === null || !isCloudFormation(content)) continue;
    sawTemplate = true;
    for (const entry of parseCloudFormation(content, file)) add(entry);
  }

  infrastructure.sort((a, b) => a.id.localeCompare(b.id));
  return { infrastructure, sawIaC: terraform.length > 0 || sawTemplate };
}

// ── Linking infrastructure to code ──────────────────────────────────────────

/** Names too generic to match on: they would link half the repository. */
const TOO_GENERIC = new Set([
  "main", "default", "this", "test", "app", "api", "web", "data", "config",
  "name", "id", "key", "value", "type", "input", "output", "queue", "bucket",
]);

function usableLiterals(infra: DeclaredInfra): string[] {
  return (infra.literals ?? [infra.name]).filter(
    (l) => l.length >= 5 && !TOO_GENERIC.has(l.toLowerCase()),
  );
}

/**
 * Attribute infrastructure to the zones whose code mentions it by name.
 *
 * This is a string match, not a resolution: a file that names a bucket is
 * assumed to use it. That is weaker than an import edge and the map says so,
 * but "which zones mention this queue" is still the question a reader has, and
 * the alternative is drawing infrastructure floating unconnected.
 *
 * `readFile` is injected so a caller that already holds file contents (the
 * scanner) does not read the tree twice.
 */
export function linkInfrastructure(
  infrastructure: DeclaredInfra[],
  filePaths: string[],
  readFile: (path: string) => string | null,
): DeclaredInfra[] {
  const candidates = infrastructure.filter(
    (i) => i.origin !== "config" && (i.usedBy ?? []).length === 0,
  );
  if (candidates.length === 0) return infrastructure;

  const literalsById = new Map<string, string[]>();
  for (const infra of candidates) {
    const literals = usableLiterals(infra);
    if (literals.length > 0) literalsById.set(infra.id, literals);
  }
  if (literalsById.size === 0) return infrastructure;

  const hits = new Map<string, Set<string>>();
  for (const path of filePaths) {
    const content = readFile(path);
    if (!content) continue;
    for (const [id, literals] of literalsById) {
      if (literals.some((l) => content.includes(l))) {
        if (!hits.has(id)) hits.set(id, new Set());
        hits.get(id)!.add(path);
      }
    }
  }

  return infrastructure.map((infra) => {
    const found = hits.get(infra.id);
    if (!found) return infra;
    return { ...infra, usedBy: [...found].sort() };
  });
}

// ── Assembly ────────────────────────────────────────────────────────────────

/**
 * Discover everything the import graph does not show, from scratch.
 *
 * The compute path. `export/iso-declared.ts` prefers the persisted
 * `infrastructure.json` and falls back here when there is none — a repo
 * scanned with no analysis, or an analysis made before the file existed.
 *
 * `readFile` lets the scanner reuse contents it already has; when omitted,
 * files are read on demand and only if there is IaC to link.
 */
export function computeInfrastructure(
  root: string,
  filePaths: string[],
  readFile?: (path: string) => string | null,
): DeclaredArchitecture {
  const config = readDeclaredConfig(root);
  const iac = discoverFromIaC(root);

  const read =
    readFile ??
    ((path: string): string | null => {
      try {
        const full = join(root, path);
        if (!existsSync(full) || statSync(full).size > 1_000_000) return null;
        return readFileSync(full, "utf-8");
      } catch {
        return null;
      }
    });

  const infrastructure = linkInfrastructure(
    [...config.infrastructure, ...iac.infrastructure],
    filePaths,
    read,
  );

  return { seams: config.seams, infrastructure, sawIaC: iac.sawIaC };
}

// ── Persisted shape ─────────────────────────────────────────────────────────

/**
 * Convert the in-memory architecture to the shape written to disk.
 *
 * The persisted form separates links from resources: `usedBy` is an
 * attribution, not a property of the resource, and keeping it apart lets a
 * consumer read "what infrastructure is there" without taking a position on
 * how firmly each use was established. `evidence` records that: `config` for
 * a link a person declared, `name-literal` for one found by matching the
 * resource's name in source.
 *
 * **Discovery order is preserved, not re-sorted.** Sorting here would be the
 * obvious thing and would be wrong: discovery emits config-declared resources
 * before IaC ones, and a config `usedBy` list is in the order a person wrote
 * it. Re-ordering either would make a map drawn from this file differ from one
 * drawn from a fresh discovery, which is precisely what persisting it must not
 * do. Byte-stability across runs comes from discovery being deterministic and
 * from `toCanonicalJSON` ordering object keys — not from sorting these arrays.
 */
export function toInfrastructureData(arch: DeclaredArchitecture): InfrastructureData {
  const resources: InfraResource[] = [];
  const links: InfraLink[] = [];

  for (const infra of arch.infrastructure) {
    const evidence: InfraLink["evidence"] = infra.origin === "config" ? "config" : "name-literal";
    resources.push({
      id: infra.id,
      name: infra.name,
      kind: infra.kind,
      origin: infra.origin,
      ...(infra.note === undefined ? {} : { note: infra.note }),
      ...(infra.literals === undefined ? {} : { literals: infra.literals }),
    });
    for (const target of infra.usedBy ?? []) {
      links.push({ resourceId: infra.id, target, evidence });
    }
  }

  return { resources, seams: arch.seams, links, sawIaC: arch.sawIaC };
}

/**
 * Rebuild the in-memory architecture from the persisted file.
 *
 * Exactly inverts `toInfrastructureData`, so a map rendered from the file is
 * byte-identical to one rendered from a fresh discovery. `usedBy` is restored
 * even when empty, because the discovery path sets it to `[]` rather than
 * leaving it absent and the two must not differ. Link order is taken as
 * stored for the same reason sorting is not done on the way out.
 */
export function fromInfrastructureData(data: InfrastructureData): DeclaredArchitecture {
  const byResource = new Map<string, string[]>();
  for (const link of data.links) {
    const existing = byResource.get(link.resourceId);
    if (existing) existing.push(link.target);
    else byResource.set(link.resourceId, [link.target]);
  }

  const infrastructure: DeclaredInfra[] = data.resources.map((resource) => ({
    id: resource.id,
    name: resource.name,
    kind: resource.kind,
    usedBy: byResource.get(resource.id) ?? [],
    ...(resource.note === undefined ? {} : { note: resource.note }),
    origin: resource.origin,
    ...(resource.literals === undefined ? {} : { literals: resource.literals }),
  }));

  return { seams: data.seams, infrastructure, sawIaC: data.sawIaC };
}

/**
 * Read `infrastructure.json` out of an analysis directory.
 *
 * Answers `null` when the file is absent — an analysis produced before this
 * file existed — so the caller can fall back to discovering it. A malformed
 * file reads as absent for the same reason: falling back costs a tree walk,
 * while failing would take the whole map down over a file nothing had to have.
 */
export function readInfrastructure(svDir: string): InfrastructureData | null {
  const data = readJson<InfrastructureData>(join(svDir, DATA_FILES.infrastructure));
  if (!data || !Array.isArray(data.resources) || !Array.isArray(data.links)) return null;
  if (!Array.isArray(data.seams)) return null;
  return data;
}
