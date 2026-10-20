/**
 * The Terraform pack, run over its fixture project, must reproduce its
 * committed goldens: the query captures (`golden.json`) and the model with
 * the `resources` facts read from it (`model.json`). Update both with
 * `pnpm --filter @n-dx/lang-terraform test:update-goldens`; a plain test run
 * never writes.
 *
 * The fixture covers resources, data sources, local and registry modules,
 * providers with versions, the backend, variables, outputs, locals and
 * references, and the audit attributes of RDS and Aurora, Cloud SQL, Lambda
 * and Cloud Functions, EKS and GKE, and Cloud Run.
 *
 * Skips when the grammar is not built (`pnpm --filter @n-dx/lang-terraform
 * build:grammars`); a missing fixture fails.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  checkGolden,
  fixtureDirFor,
  goldenPathFor,
  runPackOverFixture,
  skipUnlessGrammar,
  updateRequested,
  type ParsedFile,
} from "@n-dx/lang-runtime";
import { buildTerraformModel, terraformGrammarPath, terraformPack, terraformResourceFacts } from "../../src/index.js";
import { PACK_FIXTURE_ROOT } from "../helpers/pack-fixtures.js";

const dir = fixtureDirFor(PACK_FIXTURE_ROOT, terraformPack);

/** The model and its facts as stable JSON: two-space, trailing newline, module paths as an object. */
function modelText(files: readonly ParsedFile[]): string {
  const model = buildTerraformModel(files);
  const facts = terraformResourceFacts(
    model,
    files.map((f) => f.path),
  );
  const serializable = {
    model: { ...model, modulePaths: Object.fromEntries([...model.modulePaths].sort()) },
    facts: Object.fromEntries([...facts].sort(([a], [b]) => a.localeCompare(b))),
  };
  return `${JSON.stringify(serializable, null, 2)}\n`;
}

describe("terraform pack golden", () => {
  it("has a fixture project", () => {
    expect(existsSync(dir), `missing ${dir}`).toBe(true);
  });

  it("matches its goldens", async (ctx) => {
    skipUnlessGrammar(ctx, terraformGrammarPath());
    const actual = await runPackOverFixture({ pack: terraformPack, grammarPath: terraformGrammarPath() }, dir);
    expect(actual.files.length).toBeGreaterThan(0);
    expect(actual.files.every((f) => f.status === "parsed" && !f.hasErrorNodes && !f.hasMissingNodes)).toBe(true);
    expect(checkGolden(actual, goldenPathFor(dir), updateRequested())).toMatch(/matched|updated/);

    const parsed = actual.files.filter((f): f is ParsedFile => f.status === "parsed");
    const text = modelText(parsed);
    const modelPath = join(dir, "model.json");
    if (updateRequested()) {
      writeFileSync(modelPath, text);
      return;
    }
    expect(existsSync(modelPath), `No golden at ${modelPath}. Create it with the test:update-goldens script.`).toBe(true);
    expect(text, `The model differs from ${modelPath}; if intended, review it and run test:update-goldens.`).toBe(
      readFileSync(modelPath, "utf-8"),
    );
  });
});
