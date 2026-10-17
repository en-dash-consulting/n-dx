/**
 * Missing opt-in packs through `analyze`: a pack the project does not list
 * gets no per-language warning, only one end-of-run line naming every such
 * pack; a listed one is still warned about. The missing packs are simulated
 * at the loader: their import fails as an uninstalled package's does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cmdAnalyze } from "../../src/cli/commands/analyze.js";

vi.mock("../../src/language/pack-loader.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/language/pack-loader.js")>();
  const missing = <P extends { id: string; packageName: string }>(pack: P): P =>
    ["java", "terraform", "python"].includes(pack.id)
      ? {
          ...pack,
          importByResolution: () =>
            Promise.reject(Object.assign(new Error(`Cannot find package '${pack.packageName}' imported from /x.js`), { code: "ERR_MODULE_NOT_FOUND" })),
        }
      : pack;
  return { ...original, KNOWN_PACKS: original.KNOWN_PACKS.map(missing), INSTALLABLE_PACKS: original.INSTALLABLE_PACKS.map(missing) };
});

const TF = 'resource "aws_sqs_queue" "orders" {\n  name = "orders-intake-queue"\n}\n';

/** TypeScript beside Python (root package.json and pyproject.toml) and a Terraform resource. */
const POLYGLOT: Record<string, string> = {
  "package.json": "{}",
  "pyproject.toml": '[project]\nname = "svc"\n',
  "src/app.ts": 'export const queue = "orders-intake-queue";\n',
  "svc/main.py": "import os\n",
  "infra/main.tf": TF,
};

const JAVA: Record<string, string> = {
  "pom.xml": "<project><modelVersion>4.0.0</modelVersion><groupId>x</groupId><artifactId>app</artifactId></project>\n",
  "src/main/java/app/App.java": "package app;\n\npublic class App {}\n",
};

describe("analyze with opt-in packs missing", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
    vi.restoreAllMocks();
  });

  async function analyze(files: Record<string, string>): Promise<{ warnings: string[]; optional: string[] }> {
    dir = mkdtempSync(join(tmpdir(), "sv-optional-packs-"));
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    const warnings: string[] = [];
    const logs: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void warnings.push(args.join(" ")));
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void logs.push(args.join(" ")));
    await cmdAnalyze(dir, ["--fast"]);
    return {
      warnings: warnings.filter((w) => /java|terraform|python|pack/i.test(w)),
      optional: logs.filter((l) => l.includes("Optional packs")),
    };
  }

  it("names every unlisted missing pack in one line, with no per-language warning", async () => {
    const { warnings, optional } = await analyze(POLYGLOT);
    expect(warnings).toEqual([]);
    expect(optional).toEqual(["Optional packs for this repo: terraform, python — ndx sv pack add <id>"]);
  }, 60_000);

  it("suggests the Java pack for a Java repository that does not list it", async () => {
    const { warnings, optional } = await analyze(JAVA);
    expect(warnings).toEqual([]);
    expect(optional).toEqual(["Optional packs for this repo: java — ndx sv pack add <id>"]);
  }, 60_000);

  it("warns about a listed missing pack and suggests only the unlisted ones", async () => {
    const { warnings, optional } = await analyze({ ...POLYGLOT, ".n-dx.json": JSON.stringify({ sourcevision: { packs: ["python"] } }) });
    expect(warnings).toEqual([
      "Python: pack @n-dx/lang-python is not installed; Python files get inventory only. Install it with `ndx sv pack add python`.",
    ]);
    expect(optional).toEqual(["Optional packs for this repo: terraform — ndx sv pack add <id>"]);
  }, 60_000);

  it("prints no line when there is nothing to suggest", async () => {
    const { warnings, optional } = await analyze({ "package.json": "{}", "src/app.ts": "export const x = 1;\n" });
    expect(warnings).toEqual([]);
    expect(optional).toEqual([]);
  }, 60_000);
});
