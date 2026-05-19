import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeText, scanRoot } from "../../scripts/check-obfuscated-code.mjs";

function packedPayloadSample() {
  const dynamic = "ev" + "al";
  return [
    `${dynamic}(function(p,a,c,k,e,d){`,
    "e=function(c){return c.toString(a)};",
    "if(!''.replace(/^/,String)){while(c--)d[e(c)]=k[c]||e(c);",
    "k=[function(e){return d[e]}];e=function(){return '\\\\w+'};c=1}",
    "while(c--)if(k[c])p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),k[c]);",
    "return p}('0 1(){2(3)}',4,4,'function|x|alert|1'.split('|'),0,{}))",
  ].join("");
}

function stringArrayDispatcherSample() {
  const hex = "_" + "0x";
  const names = ["a1b2", "c3d4", "e5f6", "a7b8", "c9d0", "e1f2", "a3b4", "c5d6"];
  const id = (index) => `${hex}${names[index % names.length]}`;
  return [
    `const ${id(0)} = ['first','second','third','fourth','fifth','sixth'];`,
    `function ${id(1)}(${id(2)}, ${id(3)}) {`,
    `  ${id(2)} = ${id(2)} - 0x0;`,
    `  return ${id(0)}[${id(2)}];`,
    "}",
    "(function(){",
    "  while(!![]){",
    "    try {",
    `      const ${id(4)} = parseInt(${id(1)}(0x1)) / 0x1 + parseInt(${id(1)}(0x2)) / 0x2;`,
    `      if (${id(4)} === 0x10) break;`,
    `      else ${id(0)}.push(${id(0)}.shift());`,
    "    } catch (err) {",
    `      ${id(0)}.push(${id(0)}.shift());`,
    "    }",
    "  }",
    "}());",
    `console.log(${id(1)}(0x3), ${id(5)}, ${id(6)}, ${id(7)}, ${id(0)}, ${id(2)}, ${id(3)});`,
  ].join("\n");
}

function encodedLoaderSample() {
  const dynamic = "ev" + "al";
  const bytes = Array.from({ length: 220 }, (_, index) => (index * 73 + 41) % 256);
  const payload = Buffer.from(bytes).toString("base64");
  return `const payload = '${payload}'; ${dynamic}(atob(payload));`;
}

describe("obfuscated code policy", () => {
  it("allows readable source", () => {
    const result = analyzeText(
      [
        "export function sum(values) {",
        "  return values.reduce((total, value) => total + value, 0);",
        "}",
      ].join("\n"),
      "src/sum.js",
    );

    expect(result.failed).toBe(false);
    expect(result.findings).toEqual([]);
  });

  it("detects eval-packed payloads", () => {
    const result = analyzeText(packedPayloadSample(), "src/packed.js");

    expect(result.failed).toBe(true);
    expect(result.findings.map((finding) => finding.code)).toContain("eval-packed-payload");
  });

  it("detects generated string-array dispatchers", () => {
    const result = analyzeText(stringArrayDispatcherSample(), "src/dispatcher.js");

    expect(result.failed).toBe(true);
    expect(result.findings.map((finding) => finding.code)).toContain("string-array-dispatcher");
  });

  it("detects encoded dynamic loaders", () => {
    const result = analyzeText(encodedLoaderSample(), "src/encoded.js");

    expect(result.failed).toBe(true);
    expect(result.findings.map((finding) => finding.code)).toContain("encoded-dynamic-execution");
  });

  it("reports obfuscated installed packages as dependency findings", () => {
    const root = mkdtempSync(join(tmpdir(), "ndx-obfuscation-policy-"));
    try {
      const srcDir = join(root, "src");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, "index.js"), "export const ok = true;\n");

      const packageRoot = join(root, "node_modules", ".pnpm", "bad-pkg@1.0.0", "node_modules", "bad-pkg");
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "bad-pkg", version: "1.0.0" }));
      writeFileSync(join(packageRoot, "index.js"), packedPayloadSample());

      const report = scanRoot(root);

      expect(report.ok).toBe(false);
      expect(report.source.findings).toEqual([]);
      expect(report.dependencies.findings).toHaveLength(1);
      expect(report.dependencies.findings[0].packageName).toBe("bad-pkg");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
