/**
 * Declared architecture: the parts of a system that static analysis cannot see.
 *
 * Two things the import graph structurally cannot show, and how they get in:
 *
 *   1. **Injection seams.** When `start.ts` passes `broadcast` into
 *      `register-scheduler.ts`, the import points one way and the runtime call
 *      points the other. Static analysis sees only the import, so the map draws
 *      an arrow that is backwards for the behaviour people care about. Seams
 *      have to be declared; they are read from `.n-dx.json`.
 *
 *   2. **Runtime infrastructure.** A queue, bucket, cache or database has no
 *      import signature at all. It is discovered from infrastructure-as-code
 *      where that exists, and otherwise declared in `.n-dx.json`.
 *
 * Both are *claims made by a human or by IaC*, not inferences, and the map
 * labels them as such — a declared seam is only as accurate as its declaration.
 *
 * Only `node:` builtins are imported, so this module bundles into the
 * standalone skill script.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, sep } from "node:path";

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

/** Read declared seams and infrastructure from `.n-dx.json`. */
export function readDeclaredConfig(root: string): {
  seams: DeclaredSeam[];
  infrastructure: DeclaredInfra[];
} {
  const config = readJson<NdxConfigShape>(join(root, ".n-dx.json"));
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
 * Resource type → coarse kind, shared by every IaC format.
 *
 * Matched as substrings against the resource type so this stays useful across
 * AWS, GCP and Azure without enumerating every provider's naming.
 *
 * One table serves Terraform and CloudFormation because `normaliseType`
 * reduces both spellings to the same shape — `AWS::S3::Bucket` and
 * `aws_s3_bucket` are the same architectural fact written two ways, and a
 * second table would be two places to forget.
 */
const IAC_KINDS: Array<[RegExp, string]> = [
  [/bucket|blob_container|storage_account/, "bucket"],
  [/sqs|_queue|servicebus_queue|pubsub_subscription/, "queue"],
  [/sns|pubsub_topic|eventgrid|event_bus|eventbridge/, "topic"],
  [/dynamodb|rds|_sql|spanner|firestore|bigtable|cosmosdb|documentdb|database/, "database"],
  [/elasticache|redis|memcache/, "cache"],
  [/kinesis|kafka|msk|firehose/, "stream"],
  [/cloudwatch_event_rule|scheduler|cron|eventbridge_rule|events_rule/, "scheduler"],
  [/secret|kms|vault|parameter/, "secrets"],
  [/lambda_function|cloud_run|cloudfunctions|container_app|ecs_service/, "compute"],
];

/**
 * Reduce a resource type to one comparable shape.
 *
 * CloudFormation separates with `::` and Azure/GCP modules sometimes with `-`
 * or `.`; Terraform uses `_`. Folding them all to `_` lets the patterns above
 * be written once in Terraform's idiom.
 */
function normaliseType(type: string): string {
  return type.toLowerCase().replace(/[:.\-/]+/g, "_");
}

function classifyResource(type: string): string | null {
  const normalised = normaliseType(type);
  for (const [pattern, kind] of IAC_KINDS) {
    if (pattern.test(normalised)) return kind;
  }
  return null;
}

const IAC_SKIP = new Set([
  "node_modules", ".git", ".terraform", "dist", "build", "vendor", "coverage",
]);

/**
 * Find IaC candidate files in one pass.
 *
 * YAML is collected separately because most of it is not infrastructure — CI
 * workflows and Kubernetes manifests outnumber CloudFormation templates in a
 * typical repository — so those candidates still have to prove themselves by
 * content before anything is parsed out of them.
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

/** Largest file worth scanning for resources; templates are not huge. */
const IAC_MAX_BYTES = 512_000;

function readCapped(root: string, file: string): string | null {
  try {
    const full = join(root, file);
    if (statSync(full).size > IAC_MAX_BYTES) return null;
    return readFileSync(full, "utf-8");
  } catch {
    return null;
  }
}

/** Discover infrastructure from Terraform `resource` blocks. */
function discoverTerraform(
  root: string,
  files: string[],
  emit: (infra: DeclaredInfra) => void,
): void {
  for (const file of files) {
    const content = readCapped(root, file);
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

      emit({
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
}

// ── CloudFormation ──────────────────────────────────────────────────────────

/**
 * Enough to call a YAML file a template.
 *
 * Either the format header, or a resource type line — the header is optional
 * in SAM and in nested stacks, so requiring it would miss real templates.
 */
const CFN_SIGNATURE = /^\s*AWSTemplateFormatVersion\s*:/m;
const CFN_ANY_TYPE = /^\s*Type\s*:\s*["']?(?:AWS|Alexa|Custom)::/m;

/** `  LogicalId:` — a mapping key with no inline value. */
const CFN_KEY = /^(\s*)([A-Za-z0-9]+)\s*:\s*$/;
/** `    Type: AWS::S3::Bucket` */
const CFN_TYPE = /^(\s*)Type\s*:\s*["']?((?:AWS|Alexa|Custom)::[A-Za-z0-9:]+)["']?\s*$/;
/** A `name`-ish property, used to match code literals. */
const CFN_NAME_ATTR =
  /^\s*(?:Name|BucketName|QueueName|TopicName|FunctionName|TableName|StreamName|DomainName|DBInstanceIdentifier|ClusterName|RoleName)\s*:\s*["']?([A-Za-z0-9._-]+)["']?\s*$/;

/**
 * Structural keys that are never a resource's logical id.
 *
 * Without this a `Properties:` block appearing before `Type:` would be paired
 * with the type and reported as the resource's name.
 */
const CFN_RESERVED = new Set([
  "Resources", "Properties", "Metadata", "Outputs", "Parameters", "Conditions",
  "Mappings", "Transform", "Globals", "Tags", "DependsOn", "CreationPolicy",
  "UpdatePolicy", "UpdateReplacePolicy", "DeletionPolicy", "Environment",
  "Variables", "Policies", "Events", "Resource",
]);

/**
 * Discover infrastructure from CloudFormation templates.
 *
 * A line scanner rather than a YAML parse, for the same reason the Terraform
 * side reads `resource` blocks rather than state: it finds what a reader would
 * see scanning the template, and it keeps this module on `node:` builtins so
 * it still bundles into the standalone skill script. Nested stacks, `!Ref`
 * intrinsics and multi-document files are out of scope by design.
 */
function discoverCloudFormation(
  root: string,
  files: string[],
  emit: (infra: DeclaredInfra) => void,
): boolean {
  let sawTemplate = false;

  for (const file of files) {
    const content = readCapped(root, file);
    if (content === null) continue;
    if (!CFN_SIGNATURE.test(content) && !CFN_ANY_TYPE.test(content)) continue;
    sawTemplate = true;

    const lines = content.split(/\r?\n/);
    let pendingId: { name: string; indent: number; line: number } | null = null;

    for (let i = 0; i < lines.length; i += 1) {
      const key = CFN_KEY.exec(lines[i]);
      if (key && !CFN_RESERVED.has(key[2])) {
        pendingId = { name: key[2], indent: key[1].length, line: i };
        continue;
      }

      const type = CFN_TYPE.exec(lines[i]);
      if (!type || !pendingId || type[1].length <= pendingId.indent) continue;

      const resourceType = type[2];
      const logicalId = pendingId;
      pendingId = null;

      const kind = classifyResource(resourceType);
      if (!kind) continue;

      // Scan the whole resource block, not just what follows `Type:` — key
      // order is free in YAML and `Properties:` often comes first.
      const literals = new Set<string>([logicalId.name]);
      for (let j = logicalId.line + 1; j < lines.length; j += 1) {
        const line = lines[j];
        if (line.trim() === "") continue;
        const indent = line.length - line.trimStart().length;
        if (indent <= logicalId.indent) break; // dedented out of the resource
        const attr = CFN_NAME_ATTR.exec(line);
        if (attr) literals.add(attr[1]);
      }

      emit({
        id: `infra:${resourceType}.${logicalId.name}`,
        name: logicalId.name,
        kind,
        usedBy: [],
        note: `${resourceType} declared in ${file}`,
        origin: file,
        literals: [...literals].sort(),
      });
    }
  }

  return sawTemplate;
}

/**
 * Discover infrastructure from infrastructure-as-code.
 *
 * Deliberately shallow across both formats: it reads resource declarations,
 * not state, modules or nested stacks, so it finds what a reader would see
 * scanning the files themselves.
 */
export function discoverFromIaC(root: string): { infrastructure: DeclaredInfra[]; sawIaC: boolean } {
  const files = findIaCFiles(root);
  if (files.terraform.length === 0 && files.yaml.length === 0) {
    return { infrastructure: [], sawIaC: false };
  }

  const infrastructure: DeclaredInfra[] = [];
  const seen = new Set<string>();
  const emit = (infra: DeclaredInfra): void => {
    if (seen.has(infra.id)) return;
    seen.add(infra.id);
    infrastructure.push(infra);
  };

  discoverTerraform(root, files.terraform, emit);
  const sawTemplate = discoverCloudFormation(root, files.yaml, emit);

  infrastructure.sort((a, b) => a.id.localeCompare(b.id));
  return { infrastructure, sawIaC: files.terraform.length > 0 || sawTemplate };
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
 * Everything the map knows that the import graph does not.
 *
 * `readFile` lets the scanner reuse contents it already has; when omitted,
 * files are read on demand and only if there is IaC to link.
 */
export function loadDeclaredArchitecture(
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
