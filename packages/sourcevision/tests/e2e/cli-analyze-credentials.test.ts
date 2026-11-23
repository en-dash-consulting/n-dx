/**
 * No credential written in source reaches an analysis output file. An
 * invented probe holds credentialed URLs, secret query parameters and a
 * key=value DSN in PHP (when the workspace PHP pack runs) and JavaScript;
 * after `sv analyze --fast`, outbound.json keeps each target's scheme, host,
 * port and path, and no file under `.sourcevision/` holds a password.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { phpConfig } from "@n-dx/lang-kit";
import { KNOWN_PACKS, loadPack } from "../../src/language/pack-loader.js";
import { REDACTED } from "../../src/util/redact-literals.js";

const CLI_PATH = join(import.meta.dirname, "../../dist/cli/index.js");

/** Every secret in the probe; none may appear in any output file. */
const SECRETS = ["php-curl-pw", "php-stream-pw", "php-guzzle-pw", "php-pdo-pw", "php-key-qs", "js-fetch-pw", "js-axios-token", "js-pg-pw"];

/** A project per language: analyze reads a JavaScript project's PHP files for inventory only. */
const JS_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "probe", dependencies: { axios: "1.0.0", pg: "8.0.0" } }),
  "src/client.js":
    "import axios from 'axios';\nimport { Client } from 'pg';\n" +
    "export const a = () => fetch('https://svc:js-fetch-pw@api.example.invalid:8443/v1/items');\n" +
    "export const b = () => axios.get('https://api.example.invalid/v2/search?q=x&access_token=js-axios-token');\n" +
    "export const c = new Client('postgres://app:js-pg-pw@db.example.invalid:5432/shop');\n",
};

const PHP_FILES: Record<string, string> = {
  "index.php":
    "<?php\n" +
    "$ch = curl_init('https://u:php-curl-pw@api.example.invalid/v1');\n" +
    "$body = file_get_contents('https://u:php-stream-pw@feed.example.invalid/rss?api_key=php-key-qs&page=2');\n" +
    "$client = new GuzzleHttp\\Client(['base_uri' => 'https://u:php-guzzle-pw@guzzle.example.invalid/api/']);\n" +
    "$db = new PDO('mysql:host=db.example.invalid;dbname=shop;password=php-pdo-pw');\n",
};

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** Write `files` to a new directory and analyze it with `--fast`. */
function analyzed(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "sv-credentials-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  execFileSync(process.execPath, [CLI_PATH, "analyze", dir, "--fast"], { encoding: "utf-8", timeout: 90_000 });
  return dir;
}

const targetsOf = (dir: string): string[] =>
  JSON.parse(readFileSync(join(dir, ".sourcevision", "outbound.json"), "utf-8")).dependencies.map((d: { target: string }) => d.target);

describe("sv analyze --fast writes no credential from source", { timeout: 120_000 }, () => {
  let jsDir: string;
  let phpDir: string;
  let phpRuns = false;

  beforeAll(async () => {
    const php = KNOWN_PACKS.find((p) => p.id === phpConfig.id)!;
    phpRuns = (await loadPack(php, { packDir: join(tmpdir(), "sv-no-packs-here") })).status === "loaded";
    jsDir = analyzed(JS_FILES);
    phpDir = analyzed(PHP_FILES);
  });
  afterAll(() => {
    for (const dir of [jsDir, phpDir]) if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("keeps a JavaScript target's scheme, host, port and path, without userinfo or secret values", () => {
    const targets = targetsOf(jsDir);
    expect(targets).toContain("https://api.example.invalid:8443/v1/items");
    expect(targets).toContain(`https://api.example.invalid/v2/search?q=x&access_token=${REDACTED}`);
    expect(targets).toContain("postgres://db.example.invalid:5432/shop");
    for (const target of targets) expect(target).not.toMatch(/:\/\/[^/?#]*@/);
  });

  it("does the same for the PHP pack's targets", (ctx) => {
    if (!phpRuns) ctx.skip();
    const targets = targetsOf(phpDir);
    expect(targets).toContain("https://api.example.invalid/v1");
    expect(targets).toContain(`https://feed.example.invalid/rss?api_key=${REDACTED}&page=2`);
    expect(targets).toContain("https://guzzle.example.invalid/api/");
    for (const target of targets) expect(target).not.toMatch(/:\/\/[^/?#]*@/);
  });

  it("leaves no secret in any output file", () => {
    for (const file of [...filesUnder(join(jsDir, ".sourcevision")), ...filesUnder(join(phpDir, ".sourcevision"))]) {
      const text = readFileSync(file, "utf-8");
      for (const secret of SECRETS) expect(text.includes(secret), `${secret} in ${file}`).toBe(false);
    }
  });
});
