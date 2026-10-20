/**
 * Python routes (the Python pack's FastAPI, Flask and Django rules) and
 * outbound calls (its python-clients rules) through the analyze pipeline, on
 * PR 14's language-neutral wiring: the imports phase's single pack call
 * collects them, the components phase adds one serverRoutes group per Python
 * file and outbound.json gains one dependency per call. Without the Python
 * pack, components and outbound are what the detectors alone produce.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pythonConfig, type FileFacts, type PackProjectRequest } from "@n-dx/lang-kit";
import { analyzeComponents } from "../../src/analyzers/components.js";
import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { detectOutbound } from "../../src/analyzers/outbound-detection.js";
import { withPackOutbound } from "../../src/analyzers/pack-framework-facts.js";
import { KNOWN_PACKS, loadPack, type KnownPack } from "../../src/language/pack-loader.js";
import type { Inventory } from "../../src/schema/v1.js";
import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const PYTHON = KNOWN_PACKS.find((p) => p.id === "python")!;

const FILES: Record<string, string> = {
  "pyproject.toml": '[project]\nname = "shop"\n',
  "shop/__init__.py": "",
  "shop/main.py":
    "from fastapi import FastAPI\nfrom shop.routes import items\n\napp = FastAPI()\napp.include_router(items.router, prefix=\"/api\")\n\n" +
    '@app.get("/health")\ndef health():\n    return "ok"\n',
  "shop/routes/__init__.py": "",
  "shop/clients.py": 'import os\nimport requests\n\nrequests.get("https://pay.example.com/charge")\nTOKEN = os.environ["PAY_TOKEN"]\n',
  "shop/routes/items.py":
    'from fastapi import APIRouter\n\nrouter = APIRouter(prefix="/items")\n\n@router.get("/")\ndef list_items():\n    return []\n\n' +
    '@router.post("/{id}")\ndef save(id: int):\n    return id\n',
  // A test file's routes and outbound calls are left out, as the detectors leave out test files.
  "tests/test_app.py":
    'import requests\nfrom fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get("/fake")\ndef fake():\n    return requests.get("https://fake.example.com")\n',
};

/** The workspace Python pack, recording each request it is sent. */
function countingPython(requests: PackProjectRequest[]): KnownPack {
  return {
    ...PYTHON,
    importByResolution: async () => {
      const load = await loadPack(PYTHON, { packDir: join(tmpdir(), "sv-no-packs-here") });
      if (load.status !== "loaded") throw new Error(load.notice.reason);
      const entry = load.entry;
      return { pack: { ...entry, analyzeProject: (request: PackProjectRequest) => (requests.push(request), entry.analyzeProject(request)) } };
    },
  };
}

const NOT_INSTALLED_PYTHON: KnownPack = {
  ...PYTHON,
  importByResolution: () =>
    Promise.reject(Object.assign(new Error("Cannot find package '@n-dx/lang-python' imported from /x.js"), { code: "ERR_MODULE_NOT_FOUND" })),
};

describe("Python routes in serverRoutes and outbound calls in outbound.json", () => {
  let dir: string;
  let inventory: Inventory;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "sv-python-framework-"));
    for (const [path, text] of Object.entries(FILES)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    inventory = await analyzeInventory(dir, { languageConfig: pythonConfig });
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  /** imports → components → outbound, as the analyze command chains them. */
  async function pipeline(python: KnownPack) {
    const facts: FileFacts[] = [];
    const imports = await analyzeImports(dir, inventory, {
      language: "python",
      packs: { packs: [python], warn: () => {}, framework: (f) => facts.push(...f) },
    });
    const components = await analyzeComponents(dir, inventory, imports, { packFacts: facts });
    const outbound = withPackOutbound(await detectOutbound(dir, inventory), inventory, facts);
    return { components, outbound, imports };
  }

  it("parses each Python file once and adds a serverRoutes group per Python file with routes", async (ctx) => {
    await skipUnlessPackRuns(ctx, "python");
    const requests: PackProjectRequest[] = [];
    const { components, outbound, imports } = await pipeline(countingPython(requests));

    expect(requests).toHaveLength(1);
    expect(requests[0].kinds).toEqual(["imports", "routes", "outboundCalls"]);
    expect(components.serverRoutes).toEqual([
      // The detectors' prefix rule (inferPrefix).
      { file: "shop/main.py", prefix: "/", routes: [{ file: "shop/main.py", method: "GET", path: "/health", handler: "health" }] },
      {
        file: "shop/routes/items.py",
        prefix: "/api/items/",
        routes: [
          { file: "shop/routes/items.py", method: "GET", path: "/api/items/", handler: "list_items" },
          { file: "shop/routes/items.py", method: "POST", path: "/api/items/{id}", handler: "save" },
        ],
      },
    ]);
    expect(components.summary.totalServerRoutes).toBe(3);

    // Only serverRoutes and its count differ from the detectors alone.
    const alone = await analyzeComponents(dir, inventory, imports);
    expect({ ...components, serverRoutes: alone.serverRoutes, summary: { ...components.summary, totalServerRoutes: alone.summary.totalServerRoutes } }).toEqual(
      alone,
    );
  });

  it("adds one outbound dependency per Python call, test files left out", async (ctx) => {
    await skipUnlessPackRuns(ctx, "python");
    const { outbound } = await pipeline(countingPython([]));
    const detected = await detectOutbound(dir, inventory);
    expect(outbound.contracts).toEqual(detected.contracts);
    expect(outbound.dependencies.filter((d) => !d.file.endsWith(".py"))).toEqual(detected.dependencies);
    expect(outbound.dependencies.filter((d) => d.file.endsWith(".py"))).toEqual([
      {
        file: "shop/clients.py",
        line: 4,
        kind: "http",
        target: "https://pay.example.com/charge",
        targetSource: "literal",
        client: "requests",
        confidence: "certain",
      },
      { file: "shop/clients.py", line: 5, kind: "env", target: "PAY_TOKEN", targetSource: "env", client: "os.environ", confidence: "certain" },
    ]);
  });

  it("without the Python pack, records exactly what the detectors alone do", async () => {
    const { components, outbound, imports } = await pipeline(NOT_INSTALLED_PYTHON);
    expect(components).toEqual(await analyzeComponents(dir, inventory, imports));
    expect(outbound).toEqual(await detectOutbound(dir, inventory));
  });
});
