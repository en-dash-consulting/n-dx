/**
 * The Terraform model as lang-kit facts: one `ResourceFact` per resource
 * block, in the file that declares it. Data sources, modules, variables and
 * the rest of the model stay in memory; only managed resources are facts.
 *
 * A resource whose audit attributes are expressions is resolved in every
 * instance of its module (`terraform-resolve.ts`). Instances that resolve
 * nothing share the as-written fact; each distinct set of resolved values
 * gets its own fact, from the first instance that gives it, carrying that
 * `instance`. `module` stays the directory's call path in every fact.
 *
 * @module lang-terraform/terraform-facts
 */

import type { FileFactFields, ProjectFactsReader } from "@n-dx/lang-runtime";
import type { ResourceFact, ResourceInstance, SourceLocation } from "@n-dx/lang-kit";
import { buildTerraformModel, type TerraformModel, type TerraformResource } from "./terraform-model.js";
import { TerraformResolver } from "./terraform-resolve.js";

function resourceFact(resource: TerraformResource, model: TerraformModel): ResourceFact {
  const module = model.modulePaths.get(resource.directory);
  const { version } = resource.provider;
  return {
    type: resource.type,
    name: resource.name,
    position: resource.span.start,
    ...(module === undefined ? {} : { module }),
    provider: { name: resource.provider.name, ...(version === undefined ? {} : { version }) },
    ...(resource.references.length === 0 ? {} : { references: resource.references }),
    ...(Object.keys(resource.attributes).length === 0 ? {} : { attributes: resource.attributes }),
  };
}

/** The call in the root module that starts `instance`'s path; undefined at a root. */
function rootCall(model: TerraformModel, instance: number): SourceLocation | undefined {
  let at = model.instances[instance];
  while (at.parent !== undefined && model.instances[at.parent].parent !== undefined) at = model.instances[at.parent];
  if (at.call === undefined) return undefined;
  const call = model.modules[at.call];
  return { file: call.file, line: call.span.start.line };
}

/** One fact per distinct resolution of the resource's expressions over its module's instances. */
function resourceFacts(
  resource: TerraformResource,
  model: TerraformModel,
  resolver: TerraformResolver,
  instancesOf: ReadonlyMap<string, readonly number[]>,
): ResourceFact[] {
  const base = resourceFact(resource, model);
  if (resource.expressions === undefined) return [base];
  const facts = new Map<string, ResourceFact>();
  for (const instance of instancesOf.get(resource.directory) ?? []) {
    const { attributes, resolved } = resolver.resolveResource(resource, instance);
    const fields = Object.keys(resolved).sort() as Array<keyof typeof resolved>;
    const distinct = JSON.stringify(fields.map((f) => [f, attributes[f], resolved[f]!.confidence]));
    if (facts.has(distinct)) continue;
    if (fields.length === 0) {
      facts.set(distinct, base);
      continue;
    }
    const { module } = model.instances[instance];
    const call = rootCall(model, instance);
    const at: ResourceInstance = {
      ...(module === undefined ? {} : { module }),
      ...(call === undefined ? {} : { call }),
      resolved,
    };
    facts.set(distinct, { ...base, attributes: { ...base.attributes, ...attributes }, instance: at });
  }
  return facts.size === 0 ? [base] : [...facts.values()];
}

/** Each parsed file's `resources`, in document order; a file without resource blocks gets an empty list. */
export function terraformResourceFacts(model: TerraformModel, paths: readonly string[]): Map<string, FileFactFields> {
  const facts = new Map<string, ResourceFact[]>(paths.map((path) => [path, []]));
  const resolver = new TerraformResolver(model);
  const instancesOf = new Map<string, number[]>();
  model.instances.forEach((instance, index) => {
    const list = instancesOf.get(instance.directory);
    if (list) list.push(index);
    else instancesOf.set(instance.directory, [index]);
  });
  for (const resource of model.resources) facts.get(resource.file)?.push(...resourceFacts(resource, model, resolver, instancesOf));
  return new Map([...facts].map(([path, resources]) => [path, { resources }]));
}

/** The pack's project facts reader: builds the model once when `resources` are wanted. */
export const readTerraformFacts: ProjectFactsReader = (files, kinds) =>
  kinds.includes("resources")
    ? terraformResourceFacts(
        buildTerraformModel(files),
        files.map((f) => f.path),
      )
    : new Map();
