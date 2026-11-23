/**
 * Outbound targets resolved through constants and configuration, and named
 * when they cannot be: an invented legacy project with a SoapClient on a
 * once-defined constant, curl on a config value set once, a concatenated
 * constant, a constant defined twice, a credentialed config URL, and
 * non-WSDL SoapClients whose `location` is a property concatenation.
 * Skips when the grammar is not built.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { skipUnlessGrammar } from "@n-dx/lang-runtime";
import { pack, phpGrammarPath } from "../../src/index.js";

const FILES: Record<string, string> = {
  "constants.php": "<?php\ndefine('BILLING_WSDL', 'https://billing.example.test/svc?wsdl');\ndefine('API_BASE', 'https://api.example.test');\ndefine('TENANT_URL', 'https://a.example.test');\n",
  "constants-b.php": "<?php\ndefine('TENANT_URL', 'https://b.example.test');\n",
  "config.php": "<?php\n$config['rates']['url'] = 'https://rates.example.test/v2';\n$config['vault']['url'] = 'https://svc:hunter2@vault.example.test/';\n",
  "calls.php": [
    "<?php",
    "$a = new SoapClient(BILLING_WSDL);",
    "$b = curl_init($config['rates']['url']);",
    "$c = curl_init(API_BASE . '/orders');",
    "$d = curl_init(TENANT_URL);",
    "$e = curl_init($config['vault']['url']);",
    "$f = curl_init($config['unset']['url']);",
    "class Gateway { private $host; function go() { return new SoapClient(null, array('location' => $this->host . '/soap.php', 'uri' => 'urn:x')); } }",
    "",
  ].join("\n"),
};

describe("php outbound targets through constants and configuration", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "php-outbound-targets-"));
    for (const [path, content] of Object.entries(FILES)) writeFileSync(join(dir, path), content);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("resolves single definitions, names the rest, and never leaves a target blank", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const result = await pack.analyzeProject({ projectDir: dir, files: Object.keys(FILES), kinds: ["imports", "outboundCalls"] });
    const calls = result.facts.find((f) => f.path === "calls.php")?.outboundCalls ?? [];
    expect(calls.map((c) => `${c.position.line} ${c.client} ${c.target} (${c.targetSource})`)).toEqual([
      "2 SoapClient https://billing.example.test/svc?wsdl (literal)",
      "3 curl https://rates.example.test/v2 (literal)",
      "4 curl https://api.example.test/orders (literal)",
      // Defined twice with different values: named, not resolved.
      "5 curl TENANT_URL (config)",
      // Resolved with its credentials dropped.
      "6 curl https://vault.example.test/ (literal)",
      "7 curl unset.url (config)",
      // Non-WSDL mode: the location option, as written when it cannot be computed.
      "8 SoapClient $this->host . '/soap.php' (unknown)",
    ]);
  });
});
