/**
 * Outbound calls (`src/php-outbound.ts`) through the pack entry, over
 * `php-outbound`: curl, the http stream functions, SoapClient, Guzzle,
 * fsockopen and environment reads, with the request keys of `$_SERVER`, local
 * files, writes, `mail()`, an unknown receiver and a namespaced `SoapClient`
 * left out. Skips when the grammar is not built.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFixtureFiles, skipUnlessGrammar } from "@n-dx/lang-runtime";
import { pack, phpGrammarPath, phpPack } from "../../src/index.js";

const dir = join(import.meta.dirname, "..", "fixtures", "php-outbound");

/** `file:line kind client target (source, confidence)` for every outbound call, in file then document order. */
async function outbound(kinds: Parameters<typeof pack.analyzeProject>[0]["kinds"] = ["outboundCalls"]) {
  const result = await pack.analyzeProject({ projectDir: dir, files: listFixtureFiles(dir, [...phpPack.config.extensions]), kinds });
  expect(result.degraded).toBeUndefined();
  return result.facts
    .slice()
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .flatMap((f) =>
      (f.outboundCalls ?? []).map((c) => `${f.path}:${c.position.line} ${c.kind} ${c.client} ${JSON.stringify(c.target)} (${c.targetSource}, ${c.confidence})`),
    );
}

describe("php outbound calls", () => {
  it("reports HTTP, SOAP and environment calls", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    expect(await outbound()).toEqual([
      'curl.php:4 http curl "https://legacy.example.com/orders" (literal, certain)',
      'curl.php:8 http curl "api_url" (config, certain)',
      // A constant the repository defines once, in another file.
      'curl.php:12 http curl "https://payments.example.com/v1/charges" (literal, certain)',
      // A variable, then the computable leading text of the concatenation; CURL_INIT in any case.
      'curl.php:18 http curl "https://reports.example.com/daily?id=" (literal, certain)',
      // A parameter.
      'curl.php:22 http curl "$url" (unknown, certain)',
      'env.php:2 env getenv "DB_HOST" (env, certain)',
      'env.php:3 env $_ENV "APP_ENV" (env, certain)',
      'env.php:4 env $_SERVER "APP_SECRET" (env, certain)',
      'env.php:5 env $_SERVER "CACHE_DIR" (env, certain)',
      'env.php:6 env getenv "" (unknown, certain)',
      // Request keys read through getenv are not reported; OpenSSL's own SSL_CERT_FILE is.
      'env.php:36 env getenv "SSL_CERT_FILE" (env, certain)',
      'soap.php:2 http SoapClient "https://billing.example.com/service?wsdl" (literal, certain)',
      // No WSDL: the `location` option.
      'soap.php:3 http SoapClient "https://crm.example.com/soap" (literal, certain)',
      'soap.php:4 http SoapClient "shipping_wsdl" (config, certain)',
      'soap.php:5 http SoapClient "LEDGER_WSDL" (env, certain)',
      'soap.php:5 env getenv "LEDGER_WSDL" (env, certain)',
      'socket.php:2 http fsockopen "smtp.example.com" (literal, certain)',
      // A scheme alone is no target: the next part's.
      'socket.php:3 http fsockopen "MAIL_HOST" (env, certain)',
      'socket.php:3 env $_SERVER "MAIL_HOST" (env, certain)',
      // `use GuzzleHttp\Client`, base_uri from the environment, then methods on the bound property and variable.
      'src/Api.php:12 http guzzle "API_BASE" (env, certain)',
      'src/Api.php:12 env getenv "API_BASE" (env, certain)',
      'src/Api.php:17 http guzzle "/users" (literal, certain)',
      'src/Api.php:23 http guzzle "https://hooks.example.com/deploy" (literal, certain)',
      'src/Api.php:24 http guzzle "https://hooks.example.com/async" (literal, certain)',
      'streams.php:4 http file_get_contents "https://rates.example.com/latest.json" (literal, certain)',
      'streams.php:5 http fopen "http://feeds.example.com/news.xml" (literal, certain)',
      'streams.php:6 http file "https://payments.example.com/v1/status" (literal, certain)',
      'streams.php:8 http get_headers "http://status.example.com/ping" (literal, certain)',
    ]);
    // Not reported: request keys of $_SERVER, a $_SERVER key that is not a literal and writes (env.php),
    // local files and mail() (streams.php), an unknown receiver and App\SoapClient (src/Api.php).
  });

  it("follows a variable rebuilt from itself once per line, not once per path through the lines", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    // Each `$long = $long . …` line re-read every earlier one: 60 lines never finished before the test timed out.
    const rebuilt = join(import.meta.dirname, "..", "fixtures", "php-outbound-rebuilt");
    const result = await pack.analyzeProject({ projectDir: rebuilt, files: ["index.php"], kinds: ["outboundCalls"] });
    expect(result.facts.flatMap((f) => (f.outboundCalls ?? []).map((c) => `${c.position.line} ${c.target} (${c.targetSource})`))).toEqual([
      "5 https://short.example.com/q?a=1&b=2 (literal)",
      // Past the depth bound, the target is unknown rather than guessed.
      "68 $long (unknown)",
    ]);
  });

  it("gives no outbound calls when they are not wanted", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    expect(await outbound(["imports", "routes", "entryPoints"])).toEqual([]);
  });
});
