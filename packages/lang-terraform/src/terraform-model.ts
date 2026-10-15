/**
 * The Terraform model: what a project's Terraform declares, read from the
 * captures of the queries in `queries/terraform/` over every file at once.
 *
 * Terraform's unit is the directory (a module), not the file: references,
 * provider requirements and module calls resolve within a directory, and a
 * module call joins two directories. So the model is built over the whole
 * project and lives in memory; `terraform-facts.ts` turns it into lang-kit
 * `resources` facts per file.
 *
 * Every value is kept as written (`valueAsWritten`); nothing is normalised
 * here. The tables of audit attributes and registry modules carry a
 * provenance record per entry, as the queries do.
 *
 * @module lang-terraform/terraform-model
 */

import { posix } from "node:path";
import type { ResourceAttributes, SourceSpan } from "@n-dx/lang-kit";
import type { Capture, PackSourceFile, RuleProvenance } from "@n-dx/lang-runtime";

// ── Model ───────────────────────────────────────────────────────────────────

/** Where a top-level block sits. */
export interface TerraformBlock {
  /** Project-relative, forward-slash path of the file. */
  readonly file: string;
  /** The module directory: the file's directory, `.` at the project root. */
  readonly directory: string;
  /** The whole block. */
  readonly span: SourceSpan;
}

/** A resource or data block. */
export interface TerraformResource extends TerraformBlock {
  readonly mode: "managed" | "data";
  readonly type: string;
  readonly name: string;
  /** `type.name`, or `data.type.name` for a data source. */
  readonly address: string;
  /** Local name from the `provider` argument or the type's prefix; version from the directory's `required_providers`. */
  readonly provider: { readonly name: string; readonly alias?: string; readonly version?: string };
  readonly attributes: ResourceAttributes;
  /** `type.name` of the managed resources in the same directory this block references; sorted, distinct. */
  readonly references: readonly string[];
}

/** A module source in the registry address form `[hostname/]namespace/name/provider[//subdirectory]`. */
export interface RegistrySource {
  readonly hostname?: string;
  readonly namespace: string;
  readonly name: string;
  readonly provider: string;
  readonly subdirectory?: string;
}

/** A `module` block. */
export interface TerraformModuleCall extends TerraformBlock {
  readonly name: string;
  /** `module.<name>`. */
  readonly address: string;
  /** The `source` argument as written; absent when the block has none. */
  readonly source?: string;
  readonly version?: string;
  /**
   * `local` for `./` and `../` paths, `registry` for a registry address,
   * `other` for every other source (git, http, s3, a GitHub shorthand) and for
   * a block with no source.
   */
  readonly sourceKind: "local" | "registry" | "other";
  /** Local sources: the called directory, project-relative; absent when it leaves the project. */
  readonly target?: string;
  /** Local sources: the called directory holds files of the project, so the call was followed. */
  readonly followed?: boolean;
  readonly registry?: RegistrySource;
  /** Resource types the called registry module declares, from {@link REGISTRY_MODULES}. */
  readonly declares?: readonly string[];
}

/** A `provider` configuration block. */
export interface TerraformProviderConfig extends TerraformBlock {
  readonly name: string;
  readonly alias?: string;
}

/** One entry of `terraform { required_providers { … } }`. */
export interface ProviderRequirement extends TerraformBlock {
  readonly name: string;
  readonly source?: string;
  readonly version?: string;
}

/** `terraform { backend "<type>" { … } }`. */
export interface TerraformBackend extends TerraformBlock {
  readonly type: string;
}

/** A variable, output or local value. */
export interface TerraformNamed extends TerraformBlock {
  readonly name: string;
}

/** One edge of the reference graph, between two addresses in the same directory. */
export interface TerraformReference {
  readonly directory: string;
  /** `type.name`, `data.type.name`, `module.x`, `output.x` or `local.x`. */
  readonly from: string;
  /** `type.name`, `data.type.name`, `module.x`, `var.x` or `local.x`, declared in the same directory. */
  readonly to: string;
}

export interface TerraformModel {
  /** Every list is in file order, then document order. */
  readonly resources: readonly TerraformResource[];
  readonly dataSources: readonly TerraformResource[];
  readonly modules: readonly TerraformModuleCall[];
  readonly providers: readonly TerraformProviderConfig[];
  readonly requirements: readonly ProviderRequirement[];
  readonly backends: readonly TerraformBackend[];
  readonly variables: readonly TerraformNamed[];
  readonly outputs: readonly TerraformNamed[];
  readonly locals: readonly TerraformNamed[];
  /** Sorted by directory, from, to; distinct. */
  readonly references: readonly TerraformReference[];
  /**
   * The module call path per directory a followed local call reaches, e.g.
   * `module.app.module.db`: the shortest from a root module (a directory no
   * followed call reaches), then the alphabetically first. Root modules are absent.
   */
  readonly modulePaths: ReadonlyMap<string, string>;
}

// ── Tables ──────────────────────────────────────────────────────────────────

/** An argument an audit reads, and the resource types it is read from. */
export interface AuditAttributeRule {
  readonly field: keyof ResourceAttributes;
  /** Nested block types, then the argument: `["build_config", "runtime"]`. */
  readonly path: readonly string[];
  /** Resource types the rule applies to; every type when absent. */
  readonly types?: readonly string[];
  readonly provenance: RuleProvenance;
}

const providerDocs = (provider: string, resource: string): RuleProvenance => ({
  verifiedAgainst: [`registry.terraform.io/providers/hashicorp/${provider} documentation`],
  verifiedOn: "2026-10-15",
  source: `https://registry.terraform.io/providers/hashicorp/${provider}/latest/docs/resources/${resource}`,
});

/**
 * Audit attributes, first match per field wins. The generic rules (no
 * `types`) read arguments whose name means the same thing on every resource
 * that has it; the others are the names one resource type uses instead.
 */
export const AUDIT_ATTRIBUTE_RULES: readonly AuditAttributeRule[] = [
  { field: "engine", path: ["engine"], provenance: providerDocs("aws", "db_instance") },
  { field: "engineVersion", path: ["engine_version"], provenance: providerDocs("aws", "db_instance") },
  {
    field: "engineVersion",
    path: ["database_version"],
    types: ["google_sql_database_instance"],
    provenance: providerDocs("google", "sql_database_instance"),
  },
  { field: "runtime", path: ["runtime"], provenance: providerDocs("aws", "lambda_function") },
  {
    field: "runtime",
    path: ["build_config", "runtime"],
    types: ["google_cloudfunctions2_function"],
    provenance: providerDocs("google", "cloudfunctions2_function"),
  },
  { field: "image", path: ["image"], provenance: providerDocs("aws", "ecs_task_definition") },
  { field: "image", path: ["image_uri"], types: ["aws_lambda_function"], provenance: providerDocs("aws", "lambda_function") },
  {
    field: "image",
    path: ["template", "containers", "image"],
    types: ["google_cloud_run_v2_service", "google_cloud_run_v2_job"],
    provenance: providerDocs("google", "cloud_run_v2_service"),
  },
  {
    field: "image",
    path: ["template", "spec", "containers", "image"],
    types: ["google_cloud_run_service"],
    provenance: providerDocs("google", "cloud_run_service"),
  },
  { field: "clusterVersion", path: ["version"], types: ["aws_eks_cluster"], provenance: providerDocs("aws", "eks_cluster") },
  {
    field: "clusterVersion",
    path: ["min_master_version"],
    types: ["google_container_cluster"],
    provenance: providerDocs("google", "container_cluster"),
  },
  {
    field: "clusterVersion",
    path: ["kubernetes_version"],
    types: ["azurerm_kubernetes_cluster"],
    provenance: providerDocs("azurerm", "kubernetes_cluster"),
  },
];

/** A registry module and the resource types it declares; consumers classify them with `IAC_KINDS`. */
export interface RegistryModuleRule {
  /** `namespace/name/provider` on the public registry. */
  readonly module: string;
  readonly declares: readonly string[];
  readonly provenance: RuleProvenance;
}

/**
 * Registry modules whose resources were checked in their source. Only entries
 * verified against a pinned checkout are listed.
 */
export const REGISTRY_MODULES: readonly RegistryModuleRule[] = [
  {
    module: "terraform-aws-modules/rds/aws",
    declares: ["aws_db_instance"],
    provenance: {
      verifiedAgainst: ["terraform-aws-modules/terraform-aws-rds@175da043429cbbe41c512f976105719f6d0e538c"],
      verifiedOn: "2026-10-15",
      source:
        "https://github.com/terraform-aws-modules/terraform-aws-rds/blob/175da043429cbbe41c512f976105719f6d0e538c/modules/db_instance/main.tf",
    },
  },
];

/** The public registry's hostname, which a registry address may spell out. */
const PUBLIC_REGISTRY = "registry.terraform.io";

// ── Reading values ──────────────────────────────────────────────────────────

/**
 * A value as written: a quoted string without interpolation gives its content
 * (escapes kept as written), any other expression its source text.
 */
export function valueAsWritten(text: string): string {
  const quoted = text.length >= 2 && text.startsWith('"') && text.endsWith('"');
  return quoted && !text.includes("${") && !text.includes("%{") ? text.slice(1, -1) : text;
}

const IDENT = "[A-Za-z_][A-Za-z0-9_-]*";
const REGISTRY_ADDRESS = new RegExp(
  `^(?:([a-z0-9-]+(?:\\.[a-z0-9-]+)+)/)?(${IDENT})/(${IDENT})/([a-z0-9]+)(?://(.+))?$`,
);
/** Hosts Terraform reads as a VCS shorthand, never as a registry. */
const VCS_HOSTS = new Set(["github.com", "bitbucket.org"]);

/** Parse a registry module address; undefined for any other source. */
export function parseRegistrySource(source: string): RegistrySource | undefined {
  const match = REGISTRY_ADDRESS.exec(source);
  if (!match) return undefined;
  const [, hostname, namespace, name, provider, subdirectory] = match;
  if (hostname !== undefined && VCS_HOSTS.has(hostname)) return undefined;
  return {
    ...(hostname === undefined ? {} : { hostname }),
    namespace,
    name,
    provider,
    ...(subdirectory === undefined ? {} : { subdirectory }),
  };
}

const TRAVERSAL = new RegExp(`^(${IDENT})\\.(${IDENT})(?:\\[[^\\]]*\\])*(?:\\.(${IDENT}))?`);

/** Roots that name no declaration: meta-objects and iteration symbols. */
const NOT_DECLARED = new Set(["path", "terraform", "count", "each", "self"]);

/** The declaration a reference expression points at, as an address; undefined for none. */
export function referenceTarget(text: string): string | undefined {
  const match = TRAVERSAL.exec(text);
  if (!match) return undefined;
  const [, root, first, second] = match;
  if (NOT_DECLARED.has(root)) return undefined;
  if (root === "var" || root === "local" || root === "module") return `${root}.${first}`;
  if (root === "data") return second === undefined ? undefined : `data.${first}.${second}`;
  return `${root}.${first}`;
}

// ── Captures ────────────────────────────────────────────────────────────────

const span = (capture: Capture): SourceSpan => ({ start: capture.start, end: capture.end });

const before = (a: SourceSpan["start"], b: SourceSpan["start"]): number => a.line - b.line || a.column - b.column;

const within = (outer: SourceSpan, inner: SourceSpan): boolean =>
  before(outer.start, inner.start) <= 0 && before(inner.end, outer.end) <= 0;

const named = (file: PackSourceFile, query: string, name: string): Capture[] =>
  (file.captures[query] ?? []).filter((c) => c.name === name);

/** The first capture named `name` inside `outer`. */
const inside = (file: PackSourceFile, query: string, name: string, outer: SourceSpan): Capture | undefined =>
  (file.captures[query] ?? []).find((c) => c.name === name && within(outer, span(c)));

/** An argument of a top-level block: nested block types from the outside in, then its name. */
interface Argument {
  readonly path: readonly string[];
  readonly value: string;
  readonly span: SourceSpan;
}

/** Every argument inside the file's top-level blocks, read from the `arguments` query. */
function readArguments(file: PackSourceFile): Argument[] {
  const captures = file.captures.arguments ?? [];
  const nested: Array<{ span: SourceSpan; type?: string }> = [];
  const found: Array<{ span: SourceSpan; name?: string; value?: string }> = [];
  for (const capture of captures) {
    const at = span(capture);
    if (capture.name === "nested") nested.push({ span: at });
    else if (capture.name === "nested.type") {
      const block = nested.at(-1);
      if (block && before(block.span.start, at.start) === 0) block.type = capture.text;
    } else if (capture.name === "argument") found.push({ span: at });
    else {
      // A name or value belongs to the latest argument around it.
      const argument = found.at(-1);
      if (!argument || !within(argument.span, at)) continue;
      if (capture.name === "argument.name") argument.name ??= capture.text;
      else if (capture.name === "argument.value") argument.value ??= capture.text;
    }
  }
  return found.flatMap((argument) => {
    if (argument.name === undefined || argument.value === undefined) return [];
    const blocks = nested.filter((b) => b.type !== undefined && within(b.span, argument.span));
    blocks.sort((a, b) => before(a.span.start, b.span.start));
    return [{ span: argument.span, path: [...blocks.map((b) => b.type!), argument.name], value: argument.value }];
  });
}

const samePath = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((part, i) => part === b[i]);

/** The audit attributes a resource writes, by {@link AUDIT_ATTRIBUTE_RULES}. */
function auditAttributes(type: string, args: readonly Argument[]): ResourceAttributes {
  const attributes: Partial<Record<keyof ResourceAttributes, string>> = {};
  for (const rule of AUDIT_ATTRIBUTE_RULES) {
    if (attributes[rule.field] !== undefined || (rule.types && !rule.types.includes(type))) continue;
    const argument = args.find((a) => samePath(a.path, rule.path));
    if (argument) attributes[rule.field] = valueAsWritten(argument.value);
  }
  return attributes;
}

// ── Building ────────────────────────────────────────────────────────────────

const directoryOf = (path: string): string => posix.dirname(path);

interface FileModel {
  readonly resources: TerraformResource[];
  readonly dataSources: TerraformResource[];
  readonly modules: TerraformModuleCall[];
  readonly providers: TerraformProviderConfig[];
  readonly requirements: ProviderRequirement[];
  readonly backends: TerraformBackend[];
  readonly variables: TerraformNamed[];
  readonly outputs: TerraformNamed[];
  readonly locals: TerraformNamed[];
  /** Reference expressions with the address of the block (or local) holding them. */
  readonly referencesFrom: Array<{ readonly from: string; readonly to: string }>;
}

/** Read one file's declarations. Provider versions, references and module targets are settled across files later. */
function readFile(file: PackSourceFile): FileModel {
  const where = (capture: Capture): TerraformBlock => ({ file: file.path, directory: directoryOf(file.path), span: span(capture) });
  const args = readArguments(file);
  const argumentsIn = (outer: SourceSpan): Argument[] => args.filter((a) => within(outer, a.span));
  /** Address of each block (or local) that can hold references, for the reference graph. */
  const owners: Array<{ span: SourceSpan; address: string }> = [];

  const readResources = (mode: "managed" | "data"): TerraformResource[] => {
    const prefix = mode === "managed" ? "resource" : "data";
    return named(file, "resources", `${prefix}.block`).flatMap((block) => {
      const at = span(block);
      const type = inside(file, "resources", `${prefix}.type`, at)?.text;
      const name = inside(file, "resources", `${prefix}.name`, at)?.text;
      if (type === undefined || name === undefined) return [];
      const blockArgs = argumentsIn(at);
      const providerArg = blockArgs.find((a) => samePath(a.path, ["provider"]));
      const [providerName, alias] = providerArg ? providerArg.value.split(".", 2) : [type.split("_", 1)[0]];
      const address = mode === "managed" ? `${type}.${name}` : `data.${type}.${name}`;
      owners.push({ span: at, address });
      return [
        {
          ...where(block),
          mode,
          type,
          name,
          address,
          provider: { name: providerName, ...(alias === undefined ? {} : { alias }) },
          attributes: auditAttributes(type, blockArgs),
          references: [],
        },
      ];
    });
  };

  const resources = readResources("managed");
  const dataSources = readResources("data");

  const modules = named(file, "modules", "module.block").flatMap((block): TerraformModuleCall[] => {
    const at = span(block);
    const name = inside(file, "modules", "module.name", at)?.text;
    if (name === undefined) return [];
    owners.push({ span: at, address: `module.${name}` });
    const sourceText = inside(file, "modules", "module.source", at)?.text;
    const versionText = inside(file, "modules", "module.version", at)?.text;
    const source = sourceText === undefined ? undefined : valueAsWritten(sourceText);
    const call = {
      ...where(block),
      name,
      address: `module.${name}`,
      ...(source === undefined ? {} : { source }),
      ...(versionText === undefined ? {} : { version: valueAsWritten(versionText) }),
    };
    if (source !== undefined && (source.startsWith("./") || source.startsWith("../"))) {
      const target = posix.normalize(posix.join(call.directory, source)).replace(/\/$/, "");
      const outside = target === ".." || target.startsWith("../");
      return [{ ...call, sourceKind: "local", ...(outside ? {} : { target }) }];
    }
    const registry = source === undefined ? undefined : parseRegistrySource(source);
    if (registry) {
      const onPublic = registry.hostname === undefined || registry.hostname === PUBLIC_REGISTRY;
      const rule = onPublic
        ? REGISTRY_MODULES.find((r) => r.module === `${registry.namespace}/${registry.name}/${registry.provider}`)
        : undefined;
      return [{ ...call, sourceKind: "registry", registry, ...(rule ? { declares: rule.declares } : {}) }];
    }
    return [{ ...call, sourceKind: "other" }];
  });

  const providers = named(file, "providers", "provider.block").flatMap((block): TerraformProviderConfig[] => {
    const at = span(block);
    const name = inside(file, "providers", "provider.name", at)?.text;
    if (name === undefined) return [];
    const alias = inside(file, "providers", "provider.alias", at)?.text;
    return [{ ...where(block), name, ...(alias === undefined ? {} : { alias: valueAsWritten(alias) }) }];
  });

  const requirements = named(file, "terraform", "requirement").flatMap((entry): ProviderRequirement[] => {
    const at = span(entry);
    const name = inside(file, "terraform", "requirement.name", at)?.text;
    if (name === undefined) return [];
    const source = inside(file, "terraform", "requirement.source", at)?.text;
    const version = inside(file, "terraform", "requirement.version", at)?.text;
    return [
      {
        ...where(entry),
        name,
        ...(source === undefined ? {} : { source: valueAsWritten(source) }),
        ...(version === undefined ? {} : { version: valueAsWritten(version) }),
      },
    ];
  });

  const backends = named(file, "terraform", "backend.block").flatMap((block): TerraformBackend[] => {
    const type = inside(file, "terraform", "backend.type", span(block))?.text;
    return type === undefined ? [] : [{ ...where(block), type }];
  });

  /** `owner`: the address its references are recorded from; variables hold none worth recording. */
  const declared = (blockName: string, labelName: string, owner?: string): TerraformNamed[] =>
    named(file, "declarations", blockName).flatMap((block) => {
      const at = span(block);
      const name = inside(file, "declarations", labelName, at)?.text;
      if (name === undefined) return [];
      if (owner !== undefined) owners.push({ span: at, address: `${owner}.${name}` });
      return [{ ...where(block), name }];
    });
  const variables = declared("variable.block", "variable.name");
  const outputs = declared("output.block", "output.name", "output");
  const locals = named(file, "declarations", "local").flatMap((entry): TerraformNamed[] => {
    const at = span(entry);
    const name = inside(file, "declarations", "local.name", at)?.text;
    if (name === undefined) return [];
    owners.push({ span: at, address: `local.${name}` });
    return [{ ...where(entry), name }];
  });

  const referencesFrom = named(file, "references", "reference").flatMap((reference) => {
    const to = referenceTarget(reference.text);
    const owner = owners.find((o) => within(o.span, span(reference)));
    return to === undefined || owner === undefined || owner.address === to ? [] : [{ from: owner.address, to }];
  });

  return {
    resources,
    dataSources,
    modules,
    providers,
    requirements,
    backends,
    variables,
    outputs,
    locals,
    referencesFrom,
  };
}

/** The shortest call path to each directory a followed call reaches; see {@link TerraformModel.modulePaths}. */
function modulePathsOf(calls: readonly TerraformModuleCall[], directories: ReadonlySet<string>): Map<string, string> {
  const followed = calls.filter((c) => c.followed && c.target !== c.directory);
  const called = new Set(followed.map((c) => c.target!));
  const paths = new Map<string, string>();
  let layer = [...directories].filter((d) => !called.has(d)).map((d) => ({ directory: d, path: "" }));
  const seen = new Set(layer.map((l) => l.directory));
  while (layer.length > 0) {
    const next = new Map<string, string>();
    for (const { directory, path } of layer) {
      for (const call of followed) {
        if (call.directory !== directory || seen.has(call.target!)) continue;
        const candidate = path === "" ? call.address : `${path}.${call.address}`;
        const best = next.get(call.target!);
        if (best === undefined || candidate < best) next.set(call.target!, candidate);
      }
    }
    layer = [...next].map(([directory, path]) => ({ directory, path }));
    for (const { directory, path } of layer) {
      seen.add(directory);
      paths.set(directory, path);
    }
  }
  return paths;
}

/** A managed resource's address, `type.name`: every other address starts with a reserved root. */
const isManagedAddress = (address: string): boolean => !/^(?:data|module|var|local|output)\./.test(address);

const byAddress = (a: TerraformReference, b: TerraformReference): number =>
  a.directory.localeCompare(b.directory) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to);

/** Build the model from every parsed Terraform file of a project. */
export function buildTerraformModel(files: readonly PackSourceFile[]): TerraformModel {
  const ordered = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const read = ordered.map((file) => ({ file, model: readFile(file) }));

  const directories = new Set(ordered.map((f) => directoryOf(f.path)));
  const requirements = read.flatMap(({ model }) => model.requirements);
  const declaredIn = new Map<string, Set<string>>();
  const declare = (directory: string, address: string): void => {
    let set = declaredIn.get(directory);
    if (!set) declaredIn.set(directory, (set = new Set()));
    set.add(address);
  };

  for (const { model } of read) {
    for (const r of [...model.resources, ...model.dataSources]) declare(r.directory, r.address);
    for (const m of model.modules) declare(m.directory, m.address);
    for (const v of model.variables) declare(v.directory, `var.${v.name}`);
    for (const l of model.locals) declare(l.directory, `local.${l.name}`);
  }

  const references: TerraformReference[] = [];
  const edges = new Set<string>();
  for (const { file, model } of read) {
    const directory = directoryOf(file.path);
    for (const { from, to } of model.referencesFrom) {
      const key = `${directory}\0${from}\0${to}`;
      if (!declaredIn.get(directory)?.has(to) || edges.has(key)) continue;
      edges.add(key);
      references.push({ directory, from, to });
    }
  }
  references.sort(byAddress);

  const versionOf = (directory: string, provider: string): string | undefined =>
    requirements.find((r) => r.directory === directory && r.name === provider)?.version;
  const settle = (resource: TerraformResource): TerraformResource => {
    const version = versionOf(resource.directory, resource.provider.name);
    // References are already distinct and sorted by `to`.
    const referenced = references
      .filter((e) => e.directory === resource.directory && e.from === resource.address && isManagedAddress(e.to))
      .map((e) => e.to);
    return {
      ...resource,
      provider: { ...resource.provider, ...(version === undefined ? {} : { version }) },
      references: referenced,
    };
  };

  const modules = read
    .flatMap(({ model }) => model.modules)
    .map((call) =>
      call.sourceKind === "local" && call.target !== undefined ? { ...call, followed: directories.has(call.target) } : call,
    );

  return {
    resources: read.flatMap(({ model }) => model.resources).map(settle),
    dataSources: read.flatMap(({ model }) => model.dataSources).map(settle),
    modules,
    providers: read.flatMap(({ model }) => model.providers),
    requirements,
    backends: read.flatMap(({ model }) => model.backends),
    variables: read.flatMap(({ model }) => model.variables),
    outputs: read.flatMap(({ model }) => model.outputs),
    locals: read.flatMap(({ model }) => model.locals),
    references,
    modulePaths: modulePathsOf(modules, directories),
  };
}
