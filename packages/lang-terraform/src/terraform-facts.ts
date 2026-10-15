/**
 * The Terraform model as lang-kit facts: one `ResourceFact` per resource
 * block, in the file that declares it. Data sources, modules, variables and
 * the rest of the model stay in memory; only managed resources are facts.
 *
 * @module lang-terraform/terraform-facts
 */

import type { FileFactFields, ProjectFactsReader } from "@n-dx/lang-runtime";
import type { ResourceFact } from "@n-dx/lang-kit";
import { buildTerraformModel, type TerraformModel, type TerraformResource } from "./terraform-model.js";

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

/** Each parsed file's `resources`, in document order; a file without resource blocks gets an empty list. */
export function terraformResourceFacts(model: TerraformModel, paths: readonly string[]): Map<string, FileFactFields> {
  const facts = new Map<string, ResourceFact[]>(paths.map((path) => [path, []]));
  for (const resource of model.resources) facts.get(resource.file)?.push(resourceFact(resource, model));
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
