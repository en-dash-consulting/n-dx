/**
 * Terraform model fields on the resources `infrastructure.json` already lists.
 *
 * `analyzers/infrastructure.ts` finds Terraform resources with a shallow scan
 * and stays the only source of resources, links and seams (the iso-map bundle
 * is built from it). When `@n-dx/lang-terraform` loads, this step runs it over
 * the project's `.tf` files and adds `module`, `provider`, `references` and
 * `attributes` to each listed resource the model declares at the same place:
 * same file, same `<type>.<name>`. It never adds or removes a resource, a link
 * or a seam, and never changes a field already set. Resources only the model
 * finds stay out.
 *
 * The pack is opt-in. Missing, refused or degraded, it costs these fields
 * only: one notice, and the data comes back as it went in.
 *
 * @module sourcevision/analyzers/terraform-infrastructure
 */

import { extname, posix } from "node:path";
import { terraformConfig, type PackDegradation, type ResourceFact } from "@n-dx/lang-kit";
import type { InfraResource, InfrastructureData } from "../schema/v1.js";
import { KNOWN_PACKS, loadPack, packInstallCommand, type KnownPack, type PackLoaderOptions } from "../language/pack-loader.js";

export interface TerraformInfrastructureOptions {
  /** Defaults to the Terraform entry of {@link KNOWN_PACKS}. */
  readonly pack?: KnownPack;
  /** Where and how the pack is found; see `loadPack`. */
  readonly loader?: PackLoaderOptions;
  /** Receives the notice when the pack cannot be used. Defaults to `console.warn`. */
  readonly warn?: (message: string) => void;
}

const ID_PREFIX = "infra:";

const isTerraformSource = (path: string): boolean => extname(path).toLowerCase() === ".tf";

/** `<file>\0<type>.<name>`: where a resource is declared. */
const placeKey = (file: string, address: string): string => `${file}\0${address}`;

/** The resource's `<type>.<name>` when it is a Terraform resource in one of `files`. */
function terraformAddress(resource: InfraResource, files: ReadonlySet<string>): string | undefined {
  return files.has(resource.origin) && resource.id.startsWith(ID_PREFIX) ? resource.id.slice(ID_PREFIX.length) : undefined;
}

/**
 * The model's fields for `resource`. A reference is kept only when the
 * resource it names is listed and was declared in the same directory, since
 * the model's references stay inside one module.
 */
function modelFields(
  resource: InfraResource,
  fact: ResourceFact,
  listed: ReadonlyMap<string, InfraResource>,
): Partial<InfraResource> {
  const dir = posix.dirname(resource.origin);
  const references = (fact.references ?? [])
    .map((address) => `${ID_PREFIX}${address}`)
    .filter((id) => {
      const target = listed.get(id);
      return target !== undefined && posix.dirname(target.origin) === dir;
    });
  const { provider, attributes } = fact;
  return {
    ...(fact.module === undefined ? {} : { module: fact.module }),
    ...(provider === undefined ? {} : { provider: { name: provider.name, ...(provider.version === undefined ? {} : { version: provider.version }) } }),
    ...(references.length === 0 ? {} : { references }),
    ...(attributes === undefined || Object.keys(attributes).length === 0 ? {} : { attributes: { ...attributes } }),
  };
}

/**
 * Add the Terraform model's fields to the resources of `data` declared in
 * the project's `.tf` files. `paths` are the inventory's project-relative
 * paths. Returns `data` itself when there is nothing to add.
 */
export async function enrichTerraformInfrastructure(
  data: InfrastructureData,
  projectDir: string,
  paths: readonly string[],
  options: TerraformInfrastructureOptions = {},
): Promise<InfrastructureData> {
  const files = new Set(paths.filter(isTerraformSource));
  if (!data.resources.some((r) => terraformAddress(r, files) !== undefined)) return data;

  const pack = options.pack ?? KNOWN_PACKS.find((p) => p.id === terraformConfig.id)!;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const skip = (notice: PackDegradation): InfrastructureData => {
    const name = pack.config.displayName;
    warn(`${name}: ${notice.reason}; infrastructure.json gets no ${name} model fields.${notice.remedy === undefined ? "" : ` ${notice.remedy}`}`);
    return data;
  };

  const load = await loadPack(pack, options.loader);
  if (load.status !== "loaded") return skip(load.notice);
  if (!load.entry.produces.includes("resources")) return skip({ reason: 'the pack does not produce "resources"' });
  let result;
  try {
    result = await load.entry.analyzeProject({ projectDir, files: [...files].sort(), kinds: ["resources"] });
  } catch (error) {
    return skip({
      reason: `the pack failed (${error instanceof Error ? error.message : String(error)})`,
      remedy: `Reinstall it with \`${packInstallCommand(pack)}\`.`,
    });
  }
  if (result.degraded) return skip(result.degraded);

  // The first declaration wins, as it does in the shallow scan.
  const facts = new Map<string, ResourceFact>();
  for (const { path, resources } of result.facts) {
    for (const fact of resources ?? []) {
      const key = placeKey(path, `${fact.type}.${fact.name}`);
      if (!facts.has(key)) facts.set(key, fact);
    }
  }
  const listed = new Map(data.resources.filter((r) => terraformAddress(r, files) !== undefined).map((r) => [r.id, r]));

  let changed = false;
  const resources = data.resources.map((resource) => {
    const address = terraformAddress(resource, files);
    const fact = address === undefined ? undefined : facts.get(placeKey(resource.origin, address));
    if (fact === undefined) return resource;
    const added = Object.entries(modelFields(resource, fact, listed)).filter(([key]) => !(key in resource));
    if (added.length === 0) return resource;
    changed = true;
    return { ...resource, ...Object.fromEntries(added) } as InfraResource;
  });
  return changed ? { ...data, resources } : data;
}
