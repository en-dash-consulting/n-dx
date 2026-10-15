/**
 * Module instances: attributes written as `var.x`, `local.x` or a null
 * ternary resolve through the module calls that reach a module, per
 * instance, and the facts carry one entry per distinct resolution.
 *
 * Parses with the built grammar; skips when it is not built
 * (`pnpm --filter @n-dx/lang-terraform build:grammars`).
 */

import { afterAll, describe, expect, it, type TestContext } from "vitest";
import { createTreeSitterRunner, skipUnlessGrammar, type ParsedFile } from "@n-dx/lang-runtime";
import type { ResourceFact } from "@n-dx/lang-kit";
import { buildTerraformModel, terraformGrammarPath, terraformPack, terraformResourceFacts, type TerraformModel } from "../../src/index.js";

const WASM = terraformGrammarPath();
const runner = createTreeSitterRunner();
afterAll(() => runner.dispose());

/** The model and the facts of `path` for a project of `files`. */
async function project(
  ctx: TestContext,
  files: Record<string, string>,
  path = "modules/db/main.tf",
): Promise<{ model: TerraformModel; facts: readonly ResourceFact[] }> {
  skipUnlessGrammar(ctx, WASM);
  const parsed: ParsedFile[] = [];
  for (const [file, source] of Object.entries(files)) {
    const result = await runner.parseSource({ pack: terraformPack, grammarPath: WASM }, file, source);
    if (result.status !== "parsed") throw new Error(`${file} did not parse`);
    parsed.push(result);
  }
  const model = buildTerraformModel(parsed);
  const facts = terraformResourceFacts(
    model,
    parsed.map((f) => f.path),
  );
  return { model, facts: facts.get(path)?.resources ?? [] };
}

const DB = `variable "engine" {
  type = string
}

resource "aws_db_instance" "this" {
  engine = var.engine
}
`;

const call = (source: string, args: string, name = "db"): string => `module "${name}" {
  source = "${source}"
${args}
}
`;

describe("module instances", () => {
  it("resolves a literal argument at the call", async (ctx) => {
    const { facts } = await project(ctx, {
      "main.tf": call("./modules/db", '  engine = "postgres"'),
      "modules/db/main.tf": DB,
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      module: "module.db",
      attributes: { engine: "postgres" },
      instance: {
        module: "module.db",
        call: { file: "main.tf", line: 1 },
        resolved: { engine: { written: "var.engine", confidence: "literal", from: { file: "main.tf", line: 3 } } },
      },
    });
  });

  it("takes the variable's literal default when the call does not pass it", async (ctx) => {
    const { facts } = await project(ctx, {
      "main.tf": call("./modules/db", ""),
      "modules/db/main.tf": DB.replace("type = string", 'default = "mysql"'),
    });
    expect(facts[0]).toMatchObject({
      attributes: { engine: "mysql" },
      instance: { resolved: { engine: { confidence: "literal", from: { file: "modules/db/main.tf", line: 2 } } } },
    });
  });

  it("gives a root module its defaults only", async (ctx) => {
    const { facts } = await project(ctx, { "modules/db/main.tf": DB.replace("type = string", 'default = "mysql"') });
    expect(facts[0]).toMatchObject({ attributes: { engine: "mysql" } });
    expect(facts[0].instance).toEqual({ resolved: { engine: expect.objectContaining({ written: "var.engine" }) } });
  });

  it("passes a value down nested calls, resolving each argument in its caller", async (ctx) => {
    const { model, facts } = await project(ctx, {
      "examples/pg/main.tf": call("../..", '  db_engine = "postgres"', "root"),
      "main.tf": `variable "db_engine" {}\n${call("./modules/db", "  engine = var.db_engine")}`,
      "modules/db/main.tf": DB,
    });
    expect(model.instances.map((i) => i.module)).toEqual([undefined, "module.root", "module.root.module.db"]);
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      attributes: { engine: "postgres" },
      instance: {
        module: "module.root.module.db",
        call: { file: "examples/pg/main.tf", line: 1 },
        resolved: { engine: { from: { file: "examples/pg/main.tf", line: 3 } } },
      },
    });
  });

  it("resolves a local, and a local that passes another local or a variable", async (ctx) => {
    const { facts } = await project(ctx, {
      "main.tf": call("./modules/db", '  engine = "mariadb"'),
      "modules/db/main.tf": `variable "engine" {}
locals {
  chosen  = local.passed
  passed  = var.engine
  version = "10.11"
}

resource "aws_db_instance" "this" {
  engine         = local.chosen
  engine_version = local.version
}
`,
    });
    expect(facts[0]).toMatchObject({
      attributes: { engine: "mariadb", engineVersion: "10.11" },
      instance: {
        resolved: {
          engine: { written: "local.chosen", confidence: "literal", from: { file: "main.tf", line: 3 } },
          engineVersion: { written: "local.version", from: { file: "modules/db/main.tf", line: 5 } },
        },
      },
    });
  });

  it("resolves the non-null branch of a null ternary as conditional", async (ctx) => {
    const { facts } = await project(ctx, {
      "main.tf": call("./modules/db", '  engine = "postgres"\n  replica = false'),
      "modules/db/main.tf": `variable "engine" {}
variable "replica" {}
locals {
  is_replica = var.replica
}

resource "aws_db_instance" "this" {
  engine         = local.is_replica ? null : var.engine
  engine_version = var.replica ? "16" : null
}
`,
    });
    expect(facts[0]).toMatchObject({
      attributes: { engine: "postgres", engineVersion: "16" },
      instance: {
        resolved: {
          engine: { written: "local.is_replica ? null : var.engine", confidence: "conditional" },
          engineVersion: { confidence: "conditional", from: { file: "modules/db/main.tf", line: 7 } },
        },
      },
    });
  });

  it("leaves an expression it cannot resolve as written", async (ctx) => {
    const { facts } = await project(ctx, {
      "main.tf": call("./modules/db", '  engine = upper("postgres")\n  family = "pg"'),
      "modules/db/main.tf": `variable "engine" {}
variable "family" {}

resource "aws_db_instance" "this" {
  engine         = var.engine
  engine_version = "\${var.family}-15"
  image          = var.missing
}
`,
    });
    expect(facts).toEqual([expect.not.objectContaining({ instance: expect.anything() })]);
    expect(facts[0].attributes).toEqual({ engine: "var.engine", engineVersion: '"${var.family}-15"', image: "var.missing" });
  });

  it("gives one fact per distinct resolution, and one as written for instances that resolve nothing", async (ctx) => {
    const { facts } = await project(ctx, {
      "a/main.tf": call("../modules/db", '  engine = "postgres"'),
      "b/main.tf": call("../modules/db", '  engine = "mysql"'),
      "c/main.tf": call("../modules/db", '  engine = "postgres"'),
      "d/main.tf": `variable "engine" {}\n${call("../modules/db", "  engine = var.engine")}`,
      "modules/db/main.tf": DB,
    });
    expect(facts.map((f) => [f.attributes?.engine, f.instance?.call?.file])).toEqual([
      ["postgres", "a/main.tf"],
      ["mysql", "b/main.tf"],
      ["var.engine", undefined],
    ]);
    expect(facts.every((f) => f.module === "module.db")).toBe(true);
  });

  it("does not follow a module cycle, or a local that reaches itself", async (ctx) => {
    const { model, facts } = await project(ctx, {
      "main.tf": call("./a", '  engine = "postgres"', "a"),
      "a/main.tf": `variable "engine" {}\n${call("../b", "  engine = var.engine", "b")}`,
      "b/main.tf": `variable "engine" {}
${call("../a", "  engine = var.engine", "a")}
locals {
  x = local.y
  y = local.x
}

resource "aws_db_instance" "this" {
  engine         = var.engine
  engine_version = local.x
}
`,
    }, "b/main.tf");
    expect(model.instances.map((i) => i.module)).toEqual([undefined, "module.a", "module.a.module.b"]);
    expect(facts).toHaveLength(1);
    expect(facts[0].attributes).toEqual({ engine: "postgres", engineVersion: "local.x" });
    expect(Object.keys(facts[0].instance!.resolved)).toEqual(["engine"]);
  });
});
