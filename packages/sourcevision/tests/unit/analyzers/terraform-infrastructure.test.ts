/**
 * The Terraform model's fields on infrastructure.json resources, over a
 * stand-in pack. The real pack through `analyze` is covered by
 * tests/integration/terraform-infrastructure-model.test.ts.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { terraformConfig, type FileFacts, type LanguagePackEntry, type PackProjectRequest, type PackProjectResult } from "@n-dx/lang-kit";
import { enrichTerraformInfrastructure } from "../../../src/analyzers/terraform-infrastructure.js";
import type { KnownPack } from "../../../src/language/pack-loader.js";
import type { InfraResource, InfrastructureData } from "../../../src/schema/v1.js";

const VERSION = "1.2.3";

const resource = (type: string, name: string, origin: string, extra: Partial<InfraResource> = {}): InfraResource => ({
  id: `infra:${type}.${name}`,
  name,
  kind: "database",
  origin,
  note: `${type} declared in ${origin}`,
  literals: [name],
  ...extra,
});

const data = (resources: InfraResource[]): InfrastructureData => ({
  resources,
  seams: [{ from: "a", to: "b" }],
  links: resources.map((r) => ({ resourceId: r.id, target: "src/app.ts", evidence: "name-literal" as const })),
  sawIaC: true,
});

interface Stub {
  readonly pack: KnownPack;
  readonly requests: PackProjectRequest[];
  imports: number;
}

/** A Terraform pack answering with `facts`, or whose import or run fails as asked. */
function stubPack(found: { facts?: FileFacts[]; result?: PackProjectResult; importError?: Error; runError?: Error; produces?: LanguagePackEntry["produces"] }): Stub {
  const stub: Stub = {
    requests: [],
    imports: 0,
    pack: {
      id: terraformConfig.id,
      packageName: "@n-dx/lang-terraform",
      config: terraformConfig,
      importByResolution: () => {
        stub.imports++;
        if (found.importError) return Promise.reject(found.importError);
        const entry: LanguagePackEntry = {
          packageName: "@n-dx/lang-terraform",
          version: VERSION,
          id: terraformConfig.id,
          config: terraformConfig,
          produces: found.produces ?? ["resources"],
          analyzeProject: async (request) => {
            stub.requests.push(request);
            if (found.runError) throw found.runError;
            return found.result ?? { facts: found.facts ?? [], unparsed: [] };
          },
        };
        return Promise.resolve({ pack: entry });
      },
    },
  };
  return stub;
}

const notInstalled = Object.assign(new Error("Cannot find package '@n-dx/lang-terraform' imported from /x.js"), {
  code: "ERR_MODULE_NOT_FOUND",
});

const DB = resource("aws_db_instance", "main", "infra/main.tf");
const BUCKET = resource("aws_s3_bucket", "logs", "infra/main.tf", { kind: "bucket" });
const QUEUE = resource("aws_sqs_queue", "jobs", "infra/queues.tf", { kind: "queue" });
const OTHER_BUCKET = resource("aws_s3_bucket", "archive", "modules/store/main.tf", { kind: "bucket" });
const PATHS = ["src/app.ts", "infra/main.tf", "infra/queues.tf", "infra/terraform.tfvars", "modules/store/main.tf"];

const position = { line: 1, column: 0 };

describe("enrichTerraformInfrastructure", () => {
  let packDir: string;
  beforeAll(() => {
    packDir = mkdtempSync(join(tmpdir(), "sv-tf-infra-"));
  });
  afterAll(() => rmSync(packDir, { recursive: true, force: true }));

  const run = (input: InfrastructureData, stub: Stub, paths: readonly string[] = PATHS) => {
    const messages: string[] = [];
    const result = enrichTerraformInfrastructure(input, "/project", paths, {
      pack: stub.pack,
      loader: { packDir, version: VERSION },
      warn: (m) => messages.push(m),
    });
    return result.then((out) => ({ out, messages }));
  };

  it("adds the model's fields to the resource declared at the same file and address", async () => {
    const stub = stubPack({
      facts: [
        {
          path: "infra/main.tf",
          resources: [
            {
              type: "aws_db_instance",
              name: "main",
              position,
              module: "module.db",
              provider: { name: "aws", version: ">= 5.0" },
              references: ["aws_s3_bucket.logs", "aws_security_group.db", "aws_sqs_queue.jobs"],
              attributes: { engine: "postgres", engineVersion: "var.engine_version" },
            },
            { type: "aws_s3_bucket", name: "logs", position, provider: { name: "aws" } },
          ],
        },
        { path: "infra/queues.tf", resources: [] },
      ],
    });
    const input = data([DB, BUCKET, QUEUE]);
    const { out, messages } = await run(input, stub);

    expect(messages).toEqual([]);
    expect(out.resources[0]).toEqual({
      ...DB,
      module: "module.db",
      provider: { name: "aws", version: ">= 5.0" },
      // aws_security_group.db is not listed; the queue is listed from the same directory.
      references: ["infra:aws_s3_bucket.logs", "infra:aws_sqs_queue.jobs"],
      attributes: { engine: "postgres", engineVersion: "var.engine_version" },
    });
    expect(out.resources[1]).toEqual({ ...BUCKET, provider: { name: "aws" } });
    // No fact for the queue: the same object, no field added.
    expect(out.resources[2]).toBe(QUEUE);
  });

  it("hands the pack the project's .tf files only, sorted, asking for resources", async () => {
    const stub = stubPack({ facts: [] });
    await run(data([DB]), stub, ["modules/store/main.tf", "infra/main.tf", "infra/terraform.tfvars", "src/app.ts"]);
    expect(stub.requests).toEqual([
      { projectDir: "/project", files: ["infra/main.tf", "modules/store/main.tf"], kinds: ["resources"] },
    ]);
  });

  it("never adds a resource, a link or a seam", async () => {
    const stub = stubPack({
      facts: [
        {
          path: "infra/main.tf",
          resources: [
            { type: "aws_db_instance", name: "main", position, provider: { name: "aws" } },
            // Only the model finds this one.
            { type: "aws_iam_role", name: "db", position, provider: { name: "aws" } },
          ],
        },
      ],
    });
    const input = data([DB]);
    const { out } = await run(input, stub);
    expect(out.resources.map((r) => r.id)).toEqual(["infra:aws_db_instance.main"]);
    expect(out.links).toBe(input.links);
    expect(out.seams).toBe(input.seams);
    expect(out.sawIaC).toBe(true);
  });

  it("never changes a field the resource already has", async () => {
    const stub = stubPack({
      facts: [
        {
          path: "infra/main.tf",
          resources: [
            { type: "aws_db_instance", name: "main", position, module: "module.db", provider: { name: "aws" }, attributes: { engine: "mysql" } },
          ],
        },
      ],
    });
    const preset = { ...DB, module: "module.kept" };
    const { out } = await run(data([preset]), stub);
    expect(out.resources[0]).toEqual({ ...preset, provider: { name: "aws" }, attributes: { engine: "mysql" } });
  });

  it("matches by file as well as address, and keeps references within the declaring directory", async () => {
    // infrastructure.json lists infra:aws_s3_bucket.archive from modules/store; a
    // same-named bucket in infra/ is another resource and gives nothing to it.
    const stub = stubPack({
      facts: [
        {
          path: "infra/main.tf",
          resources: [
            { type: "aws_s3_bucket", name: "archive", position, attributes: { image: "x" } },
            { type: "aws_db_instance", name: "main", position, references: ["aws_s3_bucket.archive"] },
          ],
        },
        { path: "modules/store/main.tf", resources: [{ type: "aws_s3_bucket", name: "archive", position, module: "module.store" }] },
      ],
    });
    const { out } = await run(data([DB, OTHER_BUCKET]), stub);
    expect(out.resources[0]).toBe(DB);
    expect(out.resources[1]).toEqual({ ...OTHER_BUCKET, module: "module.store" });
  });

  it("returns the data untouched, with one notice, when the pack is missing", async () => {
    const input = data([DB]);
    const { out, messages } = await run(input, stubPack({ importError: notInstalled }));
    expect(out).toBe(input);
    expect(messages).toEqual([
      "Terraform: pack @n-dx/lang-terraform is not installed; infrastructure.json gets no Terraform model fields. Install it with `ndx sv pack add terraform`.",
    ]);
  });

  it("does not load the pack, or say anything, when no listed resource is declared in Terraform", async () => {
    const stub = stubPack({ importError: notInstalled });
    const yamlOnly = resource("AWS::SQS::Queue", "Jobs", "template.yaml");
    for (const [input, paths] of [
      [data([]), ["src/app.ts"]],
      [data([yamlOnly]), ["src/app.ts", "template.yaml"]],
      // Listed from a .tf file the inventory does not hold.
      [data([DB]), ["src/app.ts"]],
    ] as const) {
      const { out, messages } = await run(input, stub, paths);
      expect(out).toBe(input);
      expect(messages).toEqual([]);
    }
    expect(stub.imports).toBe(0);
  });

  it("returns the data untouched when the pack degrades, fails or does not produce resources", async () => {
    const cases: [Stub, string][] = [
      [stubPack({ result: { facts: [], unparsed: [], degraded: { reason: "grammar not built", remedy: "Build it." } } }), "Terraform: grammar not built; infrastructure.json gets no Terraform model fields. Build it."],
      [stubPack({ runError: new Error("boom") }), "Terraform: the pack failed (boom); infrastructure.json gets no Terraform model fields. Reinstall it with `ndx sv pack add terraform`."],
      [stubPack({ produces: ["imports"] }), 'Terraform: the pack does not produce "resources"; infrastructure.json gets no Terraform model fields.'],
    ];
    for (const [stub, notice] of cases) {
      const input = data([DB]);
      const { out, messages } = await run(input, stub);
      expect(out).toBe(input);
      expect(messages).toEqual([notice]);
    }
  });

  it("adds no field the model left empty", async () => {
    const stub = stubPack({
      facts: [{ path: "infra/main.tf", resources: [{ type: "aws_db_instance", name: "main", position, references: [], attributes: {} }] }],
    });
    const input = data([DB]);
    const { out } = await run(input, stub);
    expect(out).toBe(input);
  });
});
