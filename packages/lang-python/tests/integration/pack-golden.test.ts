/**
 * The Python pack, run over its fixture project, must reproduce its committed
 * goldens: the query captures with the resolver's written imports
 * (`golden.json`) and the pack entry's facts and notices (`facts.json`).
 * Update both with `pnpm --filter @n-dx/lang-python test:update-goldens`; a
 * plain test run never writes.
 *
 * The fixture covers every import form (`import a.b`, `as`, several per
 * statement, `from` with names, aliases, parentheses across lines, relative
 * `.` and `..pkg`, wildcard), `from __future__` (skipped), imports inside
 * functions, methods and conditionals, `TYPE_CHECKING` and
 * `typing.TYPE_CHECKING` blocks, `try` bodies whose handler catches
 * ImportError or ModuleNotFoundError (and one that catches neither),
 * `__all__` as a literal list and tuple and as values that are not literal,
 * decorators on classes, functions and methods, async functions and methods,
 * module-level names, a `.pyi` stub, and both dynamic imports.
 *
 * Skips when the grammar is not built (`pnpm --filter @n-dx/lang-python
 * build:grammars`); a missing fixture fails.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  checkGolden,
  fixtureDirFor,
  goldenPathFor,
  listFixtureFiles,
  runPackOverFixture,
  skipUnlessGrammar,
  updateRequested,
} from "@n-dx/lang-runtime";
import { pack, pythonGrammarPath, pythonPack } from "../../src/index.js";
import { PACK_FIXTURE_ROOT } from "../helpers/pack-fixtures.js";

const dir = fixtureDirFor(PACK_FIXTURE_ROOT, pythonPack);

describe("python pack golden", () => {
  it("has a fixture project", () => {
    expect(existsSync(dir), `missing ${dir}`).toBe(true);
  });

  it("matches its goldens", async (ctx) => {
    skipUnlessGrammar(ctx, pythonGrammarPath());
    const actual = await runPackOverFixture({ pack: pythonPack, grammarPath: pythonGrammarPath() }, dir);
    expect(actual.files.length).toBeGreaterThan(0);
    expect(actual.files.every((f) => f.status === "parsed" && !f.hasErrorNodes && !f.hasMissingNodes)).toBe(true);
    expect(checkGolden(actual, goldenPathFor(dir), updateRequested())).toMatch(/matched|updated/);

    const files = listFixtureFiles(dir, [...pythonPack.config.extensions]);
    const result = await pack.analyzeProject({ projectDir: dir, files });
    expect(result.degraded).toBeUndefined();
    const text = `${JSON.stringify(result, null, 2)}\n`;
    const factsPath = join(dir, "facts.json");
    if (updateRequested()) {
      writeFileSync(factsPath, text);
      return;
    }
    expect(existsSync(factsPath), `No golden at ${factsPath}. Create it with the test:update-goldens script.`).toBe(true);
    expect(text, `The facts differ from ${factsPath}; if intended, review them and run test:update-goldens.`).toBe(
      readFileSync(factsPath, "utf-8"),
    );
  });
});

/**
 * The routes and notices of each framework fixture (`tests/fixtures/fastapi`,
 * `flask`, `django`), through the pack entry, against `facts.json` beside it.
 * Each fixture covers every rule of its framework: cross-file
 * `include_router` and `register_blueprint`, Django `include` by string and
 * by module, a prefix that is not a literal, a router mounted twice, Flask's
 * default GET, the DRF registration notice.
 */
describe.each(["fastapi", "flask", "django"])("%s routes golden", (framework) => {
  const fixture = join(PACK_FIXTURE_ROOT, "..", framework);
  const goldenPath = join(fixture, "facts.json");

  it("matches its golden", async (ctx) => {
    skipUnlessGrammar(ctx, pythonGrammarPath());
    const files = listFixtureFiles(fixture, [".py"]);
    const result = await pack.analyzeProject({ projectDir: fixture, files, kinds: ["routes"] });
    expect(result.degraded).toBeUndefined();
    expect(result.unparsed).toEqual([]);
    const text = `${JSON.stringify(
      { facts: result.facts.map(({ path, routes }) => ({ path, routes })), notices: result.notices ?? [] },
      null,
      2,
    )}\n`;
    if (updateRequested()) {
      writeFileSync(goldenPath, text);
      return;
    }
    expect(existsSync(goldenPath), `No golden at ${goldenPath}. Create it with the test:update-goldens script.`).toBe(true);
    expect(text, `The ${framework} facts differ from ${goldenPath}; if intended, review it and run test:update-goldens.`).toBe(
      readFileSync(goldenPath, "utf-8"),
    );
  });
});

/**
 * The outbound calls and notices of `tests/fixtures/python-clients`, through
 * the pack entry, against `facts.json` beside it. The fixture covers every
 * client (requests, httpx, aiohttp, urllib, grpc, confluent_kafka,
 * kafka-python, pika, Celery, os.environ) and target rule: aliases,
 * `async with`, a Session, pika's default exchange, an f-string with a
 * settings prefix, an unknown target and likely calls.
 */
describe("python-clients outbound golden", () => {
  const fixture = join(PACK_FIXTURE_ROOT, "..", "python-clients");
  const goldenPath = join(fixture, "facts.json");

  it("matches its golden", async (ctx) => {
    skipUnlessGrammar(ctx, pythonGrammarPath());
    const files = listFixtureFiles(fixture, [".py"]);
    const result = await pack.analyzeProject({ projectDir: fixture, files, kinds: ["outboundCalls"] });
    expect(result.degraded).toBeUndefined();
    expect(result.unparsed).toEqual([]);
    const text = `${JSON.stringify(
      { facts: result.facts.map(({ path, outboundCalls }) => ({ path, outboundCalls })), notices: result.notices ?? [] },
      null,
      2,
    )}\n`;
    if (updateRequested()) {
      writeFileSync(goldenPath, text);
      return;
    }
    expect(existsSync(goldenPath), `No golden at ${goldenPath}. Create it with the test:update-goldens script.`).toBe(true);
    expect(text, `The outbound facts differ from ${goldenPath}; if intended, review it and run test:update-goldens.`).toBe(
      readFileSync(goldenPath, "utf-8"),
    );
  });
});
