/**
 * The model's pure parts: values as written, registry addresses, reference
 * targets, and module call paths over captures built by hand (no grammar).
 */

import { describe, expect, it } from "vitest";
import type { Capture, PackSourceFile } from "@n-dx/lang-runtime";
import { buildTerraformModel, parseRegistrySource, referenceTarget, valueAsWritten } from "../../src/index.js";

describe("valueAsWritten", () => {
  it("gives a plain quoted string's content and any other expression as written", () => {
    expect(valueAsWritten('"postgres"')).toBe("postgres");
    expect(valueAsWritten('"a\\"b"')).toBe('a\\"b');
    expect(valueAsWritten('"${var.engine}-x"')).toBe('"${var.engine}-x"');
    expect(valueAsWritten("var.engine_version")).toBe("var.engine_version");
    expect(valueAsWritten("15")).toBe("15");
  });

  it("keeps an expression that merely starts and ends with a string literal as written", () => {
    expect(valueAsWritten('"a" == var.x ? "b" : "c"')).toBe('"a" == var.x ? "b" : "c"');
    expect(valueAsWritten('"aurora" != "" ? "x" : "y"')).toBe('"aurora" != "" ? "x" : "y"');
    expect(valueAsWritten('"%{if true}x%{endif}"')).toBe('"%{if true}x%{endif}"');
    expect(valueAsWritten('"cost: $5"')).toBe("cost: $5");
  });
});

describe("parseRegistrySource", () => {
  it("reads namespace, name and provider, with an optional hostname and subdirectory", () => {
    expect(parseRegistrySource("terraform-aws-modules/rds/aws")).toEqual({ namespace: "terraform-aws-modules", name: "rds", provider: "aws" });
    expect(parseRegistrySource("app.terraform.io/acme/network/google//modules/vpc")).toEqual({
      hostname: "app.terraform.io",
      namespace: "acme",
      name: "network",
      provider: "google",
      subdirectory: "modules/vpc",
    });
  });

  it("is undefined for local, VCS and URL sources", () => {
    for (const source of ["./modules/db", "../db", "github.com/acme/network", "github.com/acme/network/aws", "git::https://x/y.git", "https://x/y.zip", "s3::https://b/k.zip"]) {
      expect(parseRegistrySource(source), source).toBeUndefined();
    }
  });
});

describe("referenceTarget", () => {
  it("names the declaration a traversal points at", () => {
    expect(referenceTarget("aws_db_subnet_group.this[0].name")).toBe("aws_db_subnet_group.this");
    expect(referenceTarget("data.aws_vpc.default.id")).toBe("data.aws_vpc.default");
    expect(referenceTarget("module.db.endpoint")).toBe("module.db");
    expect(referenceTarget("var.name")).toBe("var.name");
    expect(referenceTarget("local.tags")).toBe("local.tags");
  });

  it("is undefined for meta-objects and an incomplete data address", () => {
    for (const text of ["path.module", "terraform.workspace", "count.index", "each.key", "self.id", "data.aws_vpc"]) {
      expect(referenceTarget(text), text).toBeUndefined();
    }
  });
});

const at = (line: number, column = 0): Capture["start"] => ({ line, column });

/** A file with one `module` block per call, captured as the modules query would. */
function moduleFile(path: string, calls: ReadonlyArray<readonly [name: string, source: string]>): PackSourceFile {
  const modules: Capture[] = calls.flatMap(([name, source], i) => {
    const line = i * 10 + 1;
    return [
      { name: "module.block", nodeType: "block", text: "", start: at(line), end: at(line + 3, 1) },
      { name: "module.name", nodeType: "template_literal", text: name, start: at(line, 8), end: at(line, 8 + name.length) },
      { name: "module.source", nodeType: "expression", text: `"${source}"`, start: at(line + 1, 11), end: at(line + 1, 13 + source.length) },
    ];
  });
  return { path, captures: { modules } };
}

describe("module paths", () => {
  it("takes the shortest call path from a root module, then the alphabetically first", () => {
    const model = buildTerraformModel([
      moduleFile("main.tf", [["app", "./app"], ["db", "./db"]]),
      moduleFile("app/main.tf", [["store", "../db"]]),
      moduleFile("db/main.tf", [["log", "./log"]]),
      moduleFile("db/log/main.tf", []),
      moduleFile("examples/basic/main.tf", [["root", "../.."], ["alpha", "../../db"]]),
    ]);
    expect(Object.fromEntries(model.modulePaths)).toEqual({
      ".": "module.root",
      app: "module.root.module.app",
      db: "module.alpha",
      "db/log": "module.alpha.module.log",
    });
  });

  it("marks local calls that leave the project or reach no project file as not followed", () => {
    const model = buildTerraformModel([moduleFile("main.tf", [["outside", "../shared"], ["missing", "./gone"]])]);
    expect(model.modules.map(({ name, target, followed }) => ({ name, target, followed }))).toEqual([
      { name: "outside", target: undefined, followed: undefined },
      { name: "missing", target: "gone", followed: false },
    ]);
    expect(model.modulePaths.size).toBe(0);
  });
});

describe("scale", () => {
  const RESOURCES = 20_000;
  const FILES = 200;
  const PER_FILE = RESOURCES / FILES;
  const TYPE = "aws_thing";
  const name = (i: number): string => `r${String(i).padStart(5, "0")}`;
  /** Resource `i` references the `7 + (i % 2)` resources after it: 150k edges in all. */
  const targets = (i: number): string[] =>
    Array.from({ length: 7 + (i % 2) }, (_, k) => `${TYPE}.${name((i + 1 + k) % RESOURCES)}`);

  /** One directory of `FILES` files, each with `PER_FILE` resource blocks that hold their references on separate lines. */
  function directory(): PackSourceFile[] {
    const files: PackSourceFile[] = [];
    for (let f = 0; f < FILES; f++) {
      const resources: Capture[] = [];
      const references: Capture[] = [];
      let line = 1;
      for (let i = f * PER_FILE; i < (f + 1) * PER_FILE; i++) {
        const refs = targets(i);
        resources.push(
          { name: "resource.block", nodeType: "block", text: "", start: at(line), end: at(line + refs.length + 1, 1) },
          { name: "resource.type", nodeType: "string_lit", text: TYPE, start: at(line, 10), end: at(line, 10 + TYPE.length) },
          { name: "resource.name", nodeType: "string_lit", text: name(i), start: at(line, 30), end: at(line, 36) },
        );
        refs.forEach((ref, k) => {
          references.push({ name: "reference", nodeType: "variable_expr", text: `${ref}.id`, start: at(line + 1 + k, 4), end: at(line + 1 + k, 30) });
        });
        line += refs.length + 3;
      }
      files.push({ path: `infra/part${String(f).padStart(3, "0")}.tf`, captures: { resources, references } });
    }
    const requirement: Capture[] = [
      { name: "requirement", nodeType: "attribute", text: "", start: at(2), end: at(2, 40) },
      { name: "requirement.name", nodeType: "identifier", text: "aws", start: at(2), end: at(2, 3) },
      { name: "requirement.version", nodeType: "expression", text: '"~> 5.0"', start: at(2, 30), end: at(2, 38) },
    ];
    files.push({ path: "infra/versions.tf", captures: { terraform: requirement } });
    return files;
  }

  // A scan of the 150k edges per resource costs minutes here; the indexed build takes about a second.
  // The test timeout is the bound, so no clock is read.
  it("builds 20k resources and 150k reference edges in one directory", { timeout: 10_000 }, () => {
    const model = buildTerraformModel(directory());
    expect(model.resources).toHaveLength(RESOURCES);
    expect(model.references).toHaveLength(150_000);
    expect(model.resources[0].references).toEqual(targets(0).sort());
    expect(model.resources[RESOURCES - 1].references).toEqual(targets(RESOURCES - 1).sort());
    expect(new Set(model.resources.map((r) => r.provider.version))).toEqual(new Set(["~> 5.0"]));
  });
});
