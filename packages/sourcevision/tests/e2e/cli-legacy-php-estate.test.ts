/**
 * The batch path a scan wrapper runs over a legacy PHP estate, end to end
 * through the core CLI: `ndx init --no-llm`, then `ndx analyze --fast`, over
 * the invented estate in `tests/fixtures/php-legacy-estate/` (README there).
 * Both commands run as child processes with a TypeSafe key set, fake `claude`
 * and `codex` on PATH that record any call, and a fetch recorder in every node
 * process. A regression in any fix of the legacy-estate readiness change, or
 * in the PHP pack, fails one of the assertions below.
 *
 * Skips when the PHP grammar is not built (fails instead under
 * SV_REQUIRE_GRAMMARS=1, as CI runs this suite).
 */

import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const REPO_ROOT = join(import.meta.dirname, "../../../..");
const CORE_CLI = join(REPO_ROOT, "packages/core/cli.js");
const FIXTURE = join(import.meta.dirname, "../fixtures/php-legacy-estate");
const FETCH_RECORDER = pathToFileURL(join(REPO_ROOT, "tests/fixtures/no-network/fetch-recorder.mjs")).href;

/** Every secret-shaped value in the fixture; none may reach an output file. */
const SECRETS = ["brk-define-7731-pass", "brk-config-0420-pass", "brk-ini-5598-pass", "brk-curl-3307-pass"];

/** Written here, not committed, so no editor or checkout can rewrite the bytes. */
const NON_UTF8_FILES: Record<string, Buffer> = {
  "tenant-copy/lib/strings_fr.php": Buffer.concat([Buffer.from('<?php\n$hb_label = "caf'), Buffer.from([0xe9]), Buffer.from('";\n')]),
  "tenant-copy/lib/legacy_bytes.php": Buffer.concat([Buffer.from("<?php\n// "), Buffer.from([0xff, 0xfe]), Buffer.from("\n$hb_marker = 1;\n")]),
};

const VENDORS = ["claude", "codex"];

/** A fake vendor CLI that appends its name to `log` when anything runs it. */
function writeFakeVendor(binDir: string, name: string, log: string): void {
  writeFileSync(join(binDir, name), `#!/bin/sh\necho ${name} "$@" >> '${log}'\n`);
  chmodSync(join(binDir, name), 0o755);
  writeFileSync(join(binDir, `${name}.cmd`), `@echo off\r\necho ${name} %* >> "${log}"\r\n`);
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const linesOf = (path: string): string[] => (existsSync(path) ? readFileSync(path, "utf-8").trim().split("\n").filter(Boolean) : []);

interface Run {
  status: number | null;
  output: string;
}

describe("ndx init --no-llm + ndx analyze --fast over an invented legacy PHP estate", { timeout: 300_000 }, () => {
  let skipped: string | undefined;
  let scratch: string;
  let project: string;
  let svDir: string;
  let vendorLog: string;
  let fetchLog: string;
  let init: Run;
  let analyze: Run;
  const json = (file: string) => JSON.parse(readFileSync(join(svDir, file), "utf-8"));

  beforeAll(async () => {
    await skipUnlessPackRuns({ skip: (note) => (skipped = note ?? "PHP pack cannot run") }, "php");
    if (skipped) return;

    scratch = mkdtempSync(join(tmpdir(), "sv-legacy-estate-"));
    project = join(scratch, "estate");
    const binDir = join(scratch, "bin");
    const tmp = join(scratch, "tmp");
    cpSync(FIXTURE, project, { recursive: true });
    rmSync(join(project, "README.md"));
    for (const [path, bytes] of Object.entries(NON_UTF8_FILES)) writeFileSync(join(project, path), bytes);
    for (const dir of [binDir, tmp]) mkdirSync(dir);
    vendorLog = join(scratch, "vendor-calls.log");
    fetchLog = join(scratch, "fetch.log");
    for (const name of VENDORS) writeFakeVendor(binDir, name, vendorLog);

    const { CLAUDE_CLI_PATH: _claude, CODEX_CLI_PATH: _codex, ...base } = process.env;
    const env = {
      ...base,
      PATH: `${binDir}${delimiter}${process.env["PATH"] ?? ""}`,
      TMPDIR: tmp,
      TEMP: tmp,
      TMP: tmp,
      TYPESAFE_API_KEY: "tsk_legacy_estate_dummy",
      // A vendor-CLI call would be logged at the project root; none may be.
      NDX_CLI_LOG: "1",
      NODE_OPTIONS: [process.env["NODE_OPTIONS"], `--import=${FETCH_RECORDER}`].filter(Boolean).join(" "),
      NDX_TEST_FETCH_LOG: fetchLog,
    };
    const run = (args: string[]): Run => {
      const started = Date.now();
      const r = spawnSync(process.execPath, [CORE_CLI, ...args], { cwd: project, env, encoding: "utf-8", timeout: 240_000 });
      console.log(`ndx ${args[0]}: ${Date.now() - started} ms`);
      return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    };
    init = run(["init", "--no-llm", "--provider=claude", "--no-commit", "--git", project]);
    analyze = run(["analyze", "--fast", project]);
    svDir = join(project, ".ndx", "sourcevision");
  });

  afterAll(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  it("exits 0 from both commands", (ctx) => {
    if (skipped) ctx.skip(skipped);
    expect(init.status, init.output).toBe(0);
    expect(analyze.status, analyze.output).toBe(0);
  });

  it("detects PHP", (ctx) => {
    if (skipped) ctx.skip(skipped);
    expect(json("inventory.json").summary.analysedLanguages).toContain("PHP");
    expect(json("project-profile.json")).toMatchObject({ primaryLanguage: "php", languages: ["php"] });
  });

  it("resolves the include chain, the tenant override and the Composer autoload", (ctx) => {
    if (skipped) ctx.skip(skipped);
    const imports = json("imports.json");
    const edges = imports.edges.map((e: { from: string; to: string }) => `${e.from} -> ${e.to}`);
    expect(edges).toEqual(
      expect.arrayContaining([
        // Four deep from the entry script, through .inc files to a .phtml template.
        "tenant-copy/index.php -> tenant-copy/lib/bootstrap.inc",
        "tenant-copy/lib/bootstrap.inc -> tenant-copy/lib/db.inc",
        "tenant-copy/lib/db.inc -> tenant-copy/lib/ledger.inc",
        "tenant-copy/lib/ledger.inc -> tenant-copy/templates/ledger.phtml",
        // The conditional override, its fallback, and the override layered over the shared file.
        "tenant-copy/lib/bootstrap.inc -> tenant-copy/custom/hooks.inc",
        "tenant-copy/lib/bootstrap.inc -> tenant-copy/lib/hooks.inc",
        "tenant-copy/custom/hooks.inc -> tenant-copy/lib/hooks.inc",
        // PSR-4 in the PHP 8.1 trunk.
        "trunk/public/index.php -> trunk/src/Invoice.php",
        "trunk/src/Invoice.php -> trunk/src/InvoiceStatus.php",
      ]),
    );
    expect(imports.external).toContainEqual(expect.objectContaining({ package: "php:Fernwick", importedBy: ["trunk/src/Invoice.php"] }));
  });

  it("reports the tables behind database-driven code and the mysql_connect target", (ctx) => {
    if (skipped) ctx.skip(skipped);
    const database = json("sdlc-profile.json").ecosystem.php.dynamicCode.database;
    expect(database.tables).toEqual({ hb_hooks: 1, hb_rules: 1, hb_snippets: 1 });
    const targets = json("outbound.json").dependencies.map((d: { target: string; kind: string }) => `${d.kind} ${d.target}`);
    expect(targets).toContain("database db.tenant.invalid");
  });

  it("counts every legacy construct", (ctx) => {
    if (skipped) ctx.skip(skipped);
    const { rules } = json("sdlc-profile.json").ecosystem.php.legacyConstructs;
    const uses = Object.fromEntries(Object.entries(rules).map(([id, rule]) => [id, (rule as { uses: number }).uses]));
    expect(uses).toEqual({
      "asp-tags": 1,
      "create-function": 2,
      each: 1,
      "ereg-functions": 1,
      "long-superglobal-arrays": 1,
      "mysql-functions": 15,
      "php4-constructor": 1,
      "short-open-tag": 2,
    });
  });

  it("reports the files that do not parse cleanly and finishes the run", (ctx) => {
    if (skipped) ctx.skip(skipped);
    expect(json("imports.json").summary.parseIssues.php).toMatchObject({
      syntaxErrors: { count: 1, examples: ["tenant-copy/admin/report.php"] },
      oversized: { count: 0, examples: [] },
      notUtf8: { count: 2, examples: ["tenant-copy/lib/legacy_bytes.php", "tenant-copy/lib/strings_fr.php"] },
    });
    expect(analyze.output).toContain("[php-parse]");
  });

  it("makes no model call and no network request, and writes no claude_commands.log", (ctx) => {
    if (skipped) ctx.skip(skipped);
    expect(linesOf(vendorLog)).toEqual([]);
    expect(linesOf(fetchLog)).toEqual([]);
    expect(existsSync(join(project, "claude_commands.log"))).toBe(false);
  });

  it("writes no secret value to any file n-dx wrote, and names config keys only", (ctx) => {
    if (skipped) ctx.skip(skipped);
    for (const file of filesUnder(join(project, ".ndx"))) {
      const text = readFileSync(file, "latin1");
      for (const secret of SECRETS) expect(text.includes(secret), `${secret} in ${file}`).toBe(false);
    }
    const keys = json("config.json").keys.map((k: { key: string }) => k.key);
    expect(keys).toEqual(expect.arrayContaining(["DB_PASS", "db.password", "password"]));
  });
});
